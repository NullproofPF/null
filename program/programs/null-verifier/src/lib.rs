//! NULL protocol: anonymous group-membership verifier for Solana.
//!
//! Verifies Semaphore v4 Groth16 proofs (BN254, depth-16 circuit) with the
//! alt_bn128 syscalls via Light Protocol's `groth16-solana`, enforces
//! scope-bound nullifiers, and stores public verification receipts.
//!
//! Nothing in this program ever sees an identity secret. The only inputs are
//! the group's published Merkle root, a nullifier, the action message and the
//! proof itself; the scope value is derived from on-chain state so a prover
//! cannot pick an arbitrary scope to dodge a one-time restriction.

#![allow(unexpected_cfgs)]
#![allow(deprecated)]

use anchor_lang::prelude::*;
use groth16_solana::groth16::Groth16Verifier;
use solana_keccak_hasher as keccak;

pub mod verifying_key;
use verifying_key::{MERKLE_TREE_DEPTH, NR_PUBLIC_INPUTS, VERIFYING_KEY};

declare_id!("EeESX96fLQvMgRLWU5Fm1HFMofiSNPeoyymCWLAsSJrS");

/// Domain separator for scope-value derivation. Mirrored in src/lib/zk/constants.ts.
pub const SCOPE_DOMAIN: &[u8] = b"null-protocol/scope/v1";
/// Number of historical roots a group remembers (ring buffer, newest wins).
pub const ROOT_HISTORY_SIZE: usize = 8;
/// Protocol version written into every receipt.
pub const PROTOCOL_VERSION: u8 = 1;

/// BN254 scalar field modulus r, big-endian. Public inputs must be < r.
pub const SCALAR_FIELD_MODULUS_BE: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];

#[program]
pub mod null_verifier {
    use super::*;

    /// Create a membership group controlled by `admin`. `initial_root` may be
    /// all zeros for an empty group (an all-zero root is never accepted by
    /// `verify_proof`). `root_validity_slots` bounds how long a superseded root
    /// keeps verifying after a newer root is published (0 = immediately stale).
    pub fn initialize_group(
        ctx: Context<InitializeGroup>,
        group_id: [u8; 32],
        initial_root: [u8; 32],
        root_validity_slots: u64,
    ) -> Result<()> {
        let clock = Clock::get()?;
        let group = &mut ctx.accounts.group;
        group.admin = ctx.accounts.admin.key();
        group.group_id = group_id;
        group.current_root = initial_root;
        group.root_history = [RootEntry::default(); ROOT_HISTORY_SIZE];
        group.root_history_index = 0;
        group.root_updates = 0;
        group.member_count = 0;
        group.verification_count = 0;
        group.scope_count = 0;
        group.root_validity_slots = root_validity_slots;
        group.created_at_slot = clock.slot;
        group.merkle_tree_depth = MERKLE_TREE_DEPTH;
        group.bump = ctx.bumps.group;

        if initial_root != [0u8; 32] {
            require!(
                is_scalar_field_element(&initial_root),
                NullError::InvalidPublicInput
            );
            group.push_root(initial_root, 0, clock.slot);
        }

        emit!(GroupInitialized {
            group: group.key(),
            admin: group.admin,
            group_id,
            slot: clock.slot,
        });
        Ok(())
    }

    /// Publish a new Merkle root after membership changed. Admin only.
    /// The previous root stays accepted for `root_validity_slots` more slots so
    /// proofs generated moments before the update still verify.
    pub fn update_group_root(
        ctx: Context<UpdateGroupRoot>,
        new_root: [u8; 32],
        member_count: u64,
    ) -> Result<()> {
        require!(new_root != [0u8; 32], NullError::InvalidPublicInput);
        require!(
            is_scalar_field_element(&new_root),
            NullError::InvalidPublicInput
        );
        let clock = Clock::get()?;
        let group = &mut ctx.accounts.group;
        group.push_root(new_root, member_count, clock.slot);
        emit!(GroupRootUpdated {
            group: group.key(),
            root: new_root,
            member_count,
            root_updates: group.root_updates,
            slot: clock.slot,
        });
        Ok(())
    }

    /// Change how long superseded roots stay valid. Admin only.
    pub fn set_root_validity(
        ctx: Context<UpdateGroupRoot>,
        root_validity_slots: u64,
    ) -> Result<()> {
        ctx.accounts.group.root_validity_slots = root_validity_slots;
        Ok(())
    }

    /// Hand the group to a new administrator. Admin only.
    pub fn transfer_group_admin(ctx: Context<UpdateGroupRoot>, new_admin: Pubkey) -> Result<()> {
        require!(new_admin != Pubkey::default(), NullError::Unauthorized);
        ctx.accounts.group.admin = new_admin;
        Ok(())
    }

    /// Create a verification scope under a group. Admin only.
    /// `one_time` scopes accept each nullifier once (one anonymous action per
    /// member); multi-use scopes count repeat uses instead of rejecting them.
    pub fn create_scope(
        ctx: Context<CreateScope>,
        scope_id: [u8; 32],
        one_time: bool,
    ) -> Result<()> {
        let clock = Clock::get()?;
        let group = &mut ctx.accounts.group;
        let scope = &mut ctx.accounts.scope;
        scope.group = group.key();
        scope.scope_id = scope_id;
        scope.scope_value = derive_scope_value(&group.key(), &scope_id);
        scope.one_time = one_time;
        scope.verification_count = 0;
        scope.created_at_slot = clock.slot;
        scope.bump = ctx.bumps.scope;
        group.scope_count = group
            .scope_count
            .checked_add(1)
            .ok_or(NullError::Overflow)?;
        emit!(ScopeCreated {
            group: group.key(),
            scope: scope.key(),
            scope_id,
            scope_value: scope.scope_value,
            one_time,
        });
        Ok(())
    }

    /// Verify an anonymous membership proof and record a public receipt.
    ///
    /// `proof` is proof_a (64, with A already negated) | proof_b (128) | proof_c (64),
    /// big-endian limbs, G2 coordinates (c1, c0). Fails closed on every check:
    /// unknown or stale root, malformed points, invalid proof, consumed nullifier.
    pub fn verify_proof(
        ctx: Context<VerifyProof>,
        root: [u8; 32],
        nullifier: [u8; 32],
        message: [u8; 32],
        proof: [u8; 256],
    ) -> Result<()> {
        let clock = Clock::get()?;
        let group = &mut ctx.accounts.group;
        let scope = &mut ctx.accounts.scope;

        // 1. The root must be one this group's administrator actually published.
        require!(root != [0u8; 32], NullError::UnknownRoot);
        match group.root_status(&root, clock.slot) {
            RootStatus::Accepted => {}
            RootStatus::Stale => return err!(NullError::StaleRoot),
            RootStatus::Unknown => return err!(NullError::UnknownRoot),
        }

        // 2. Nullifier policy. The record is created on first use.
        let record = &mut ctx.accounts.nullifier_record;
        if record.uses == 0 {
            record.scope = scope.key();
            record.nullifier = nullifier;
            record.first_slot = clock.slot;
            record.bump = ctx.bumps.nullifier_record;
        } else if scope.one_time {
            return err!(NullError::NullifierAlreadyUsed);
        }

        // 3. Public inputs, in the circuit's order. Scope comes from chain state.
        let public_inputs: [[u8; 32]; NR_PUBLIC_INPUTS] = [
            root,
            nullifier,
            semaphore_hash(&message),
            semaphore_hash(&scope.scope_value),
        ];
        for input in public_inputs.iter() {
            require!(
                is_scalar_field_element(input),
                NullError::InvalidPublicInput
            );
        }

        // 4. Real pairing check through the alt_bn128 syscalls. Inputs were
        //    range-checked above, so the verifier's own (arkworks-based) check
        //    is skipped to keep the binary small.
        let proof_a: &[u8; 64] = proof[0..64]
            .try_into()
            .map_err(|_| NullError::MalformedProof)?;
        let proof_b: &[u8; 128] = proof[64..192]
            .try_into()
            .map_err(|_| NullError::MalformedProof)?;
        let proof_c: &[u8; 64] = proof[192..256]
            .try_into()
            .map_err(|_| NullError::MalformedProof)?;
        let mut verifier =
            Groth16Verifier::new(proof_a, proof_b, proof_c, &public_inputs, &VERIFYING_KEY)
                .map_err(|_| NullError::MalformedProof)?;
        verifier.verify_unchecked().map_err(|_| {
            msg!("groth16 verification failed");
            NullError::InvalidProof
        })?;

        // 5. Bookkeeping and receipt. Only public facts are written.
        record.uses = record.uses.checked_add(1).ok_or(NullError::Overflow)?;
        let index = scope.verification_count;
        let receipt = &mut ctx.accounts.receipt;
        receipt.group = group.key();
        receipt.scope = scope.key();
        receipt.index = index;
        receipt.root = root;
        receipt.nullifier = nullifier;
        receipt.message = message;
        receipt.slot = clock.slot;
        receipt.unix_timestamp = clock.unix_timestamp;
        receipt.version = PROTOCOL_VERSION;
        receipt.merkle_tree_depth = MERKLE_TREE_DEPTH;
        receipt.bump = ctx.bumps.receipt;

        scope.verification_count = index.checked_add(1).ok_or(NullError::Overflow)?;
        group.verification_count = group
            .verification_count
            .checked_add(1)
            .ok_or(NullError::Overflow)?;

        emit!(ProofVerified {
            group: group.key(),
            scope: scope.key(),
            receipt: receipt.key(),
            index,
            root,
            nullifier,
            message,
            slot: clock.slot,
        });
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Pure helpers (mirrored in TypeScript; covered by cross-language tests)
// ---------------------------------------------------------------------------

/// Semaphore v4 `hash()`: keccak256(value) >> 8, on 32-byte big-endian words.
pub fn semaphore_hash(value: &[u8; 32]) -> [u8; 32] {
    let digest = keccak::hash(value).to_bytes();
    let mut out = [0u8; 32];
    out[1..].copy_from_slice(&digest[..31]);
    out
}

/// keccak256(SCOPE_DOMAIN || group || scope_id) with the top byte cleared so
/// the result is always a canonical scalar-field element.
pub fn derive_scope_value(group: &Pubkey, scope_id: &[u8; 32]) -> [u8; 32] {
    let mut digest = keccak::hashv(&[SCOPE_DOMAIN, group.as_ref(), scope_id]).to_bytes();
    digest[0] = 0;
    digest
}

/// Big-endian comparison against r. Equal-length byte slices compare
/// lexicographically, which equals numeric order for unsigned big-endian words.
pub fn is_scalar_field_element(value: &[u8; 32]) -> bool {
    value.as_slice() < SCALAR_FIELD_MODULUS_BE.as_slice()
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace, PartialEq, Eq, Debug,
)]
pub struct RootEntry {
    pub root: [u8; 32],
    /// Slot at which this root was published. 0 means unused entry.
    pub published_slot: u64,
    /// Slot at which a newer root replaced it. 0 while current.
    pub superseded_slot: u64,
    /// Member count reported by the issuer alongside this root.
    pub member_count: u64,
}

#[derive(PartialEq, Eq, Debug)]
pub enum RootStatus {
    Accepted,
    Stale,
    Unknown,
}

#[account]
#[derive(InitSpace)]
pub struct Group {
    pub admin: Pubkey,
    pub group_id: [u8; 32],
    pub current_root: [u8; 32],
    pub root_history: [RootEntry; ROOT_HISTORY_SIZE],
    pub root_history_index: u8,
    pub root_updates: u64,
    pub member_count: u64,
    pub verification_count: u64,
    pub scope_count: u64,
    pub root_validity_slots: u64,
    pub created_at_slot: u64,
    pub merkle_tree_depth: u8,
    pub bump: u8,
}

impl Group {
    pub const SEED: &'static [u8] = b"group";

    pub fn push_root(&mut self, root: [u8; 32], member_count: u64, slot: u64) {
        // Mark the entry holding the current root as superseded.
        for entry in self.root_history.iter_mut() {
            if entry.published_slot != 0
                && entry.root == self.current_root
                && entry.superseded_slot == 0
            {
                entry.superseded_slot = slot;
            }
        }
        let idx = self.root_history_index as usize % ROOT_HISTORY_SIZE;
        self.root_history[idx] = RootEntry {
            root,
            published_slot: slot.max(1),
            superseded_slot: 0,
            member_count,
        };
        self.root_history_index = ((idx + 1) % ROOT_HISTORY_SIZE) as u8;
        self.current_root = root;
        self.member_count = member_count;
        self.root_updates = self.root_updates.saturating_add(1);
    }

    pub fn root_status(&self, root: &[u8; 32], current_slot: u64) -> RootStatus {
        if *root == self.current_root {
            return RootStatus::Accepted;
        }
        for entry in self.root_history.iter() {
            if entry.published_slot != 0 && entry.root == *root {
                if entry.superseded_slot == 0 {
                    return RootStatus::Accepted;
                }
                let age = current_slot.saturating_sub(entry.superseded_slot);
                return if age <= self.root_validity_slots {
                    RootStatus::Accepted
                } else {
                    RootStatus::Stale
                };
            }
        }
        RootStatus::Unknown
    }
}

#[account]
#[derive(InitSpace)]
pub struct Scope {
    pub group: Pubkey,
    pub scope_id: [u8; 32],
    /// Circuit-facing scope value (pre-hash); see `derive_scope_value`.
    pub scope_value: [u8; 32],
    pub one_time: bool,
    pub verification_count: u64,
    pub created_at_slot: u64,
    pub bump: u8,
}

impl Scope {
    pub const SEED: &'static [u8] = b"scope";
}

#[account]
#[derive(InitSpace)]
pub struct NullifierRecord {
    pub scope: Pubkey,
    pub nullifier: [u8; 32],
    pub uses: u64,
    pub first_slot: u64,
    pub bump: u8,
}

impl NullifierRecord {
    pub const SEED: &'static [u8] = b"nullifier";
}

/// Public verification receipt. Contains no identity information: the
/// nullifier is Poseidon(hash(scope), secret) and reveals nothing about which
/// commitment produced the proof.
#[account]
#[derive(InitSpace)]
pub struct Receipt {
    pub group: Pubkey,
    pub scope: Pubkey,
    pub index: u64,
    pub root: [u8; 32],
    pub nullifier: [u8; 32],
    pub message: [u8; 32],
    pub slot: u64,
    pub unix_timestamp: i64,
    pub version: u8,
    pub merkle_tree_depth: u8,
    pub bump: u8,
}

impl Receipt {
    pub const SEED: &'static [u8] = b"receipt";
}

// ---------------------------------------------------------------------------
// Instruction contexts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(group_id: [u8; 32])]
pub struct InitializeGroup<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + Group::INIT_SPACE,
        seeds = [Group::SEED, group_id.as_ref()],
        bump
    )]
    pub group: Account<'info, Group>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateGroupRoot<'info> {
    pub admin: Signer<'info>,
    #[account(mut, has_one = admin @ NullError::Unauthorized)]
    pub group: Account<'info, Group>,
}

#[derive(Accounts)]
#[instruction(scope_id: [u8; 32])]
pub struct CreateScope<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, has_one = admin @ NullError::Unauthorized)]
    pub group: Account<'info, Group>,
    #[account(
        init,
        payer = admin,
        space = 8 + Scope::INIT_SPACE,
        seeds = [Scope::SEED, group.key().as_ref(), scope_id.as_ref()],
        bump
    )]
    pub scope: Account<'info, Scope>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(root: [u8; 32], nullifier: [u8; 32])]
pub struct VerifyProof<'info> {
    /// Fee payer (usually the relayer). Never needs to be the prover.
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub group: Account<'info, Group>,
    #[account(mut, has_one = group @ NullError::ScopeGroupMismatch)]
    pub scope: Account<'info, Scope>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + NullifierRecord::INIT_SPACE,
        seeds = [NullifierRecord::SEED, scope.key().as_ref(), nullifier.as_ref()],
        bump
    )]
    pub nullifier_record: Account<'info, NullifierRecord>,
    #[account(
        init,
        payer = payer,
        space = 8 + Receipt::INIT_SPACE,
        seeds = [Receipt::SEED, scope.key().as_ref(), &scope.verification_count.to_le_bytes()],
        bump
    )]
    pub receipt: Account<'info, Receipt>,
    pub system_program: Program<'info, System>,
}

// ---------------------------------------------------------------------------
// Events and errors
// ---------------------------------------------------------------------------

#[event]
pub struct GroupInitialized {
    pub group: Pubkey,
    pub admin: Pubkey,
    pub group_id: [u8; 32],
    pub slot: u64,
}

#[event]
pub struct GroupRootUpdated {
    pub group: Pubkey,
    pub root: [u8; 32],
    pub member_count: u64,
    pub root_updates: u64,
    pub slot: u64,
}

#[event]
pub struct ScopeCreated {
    pub group: Pubkey,
    pub scope: Pubkey,
    pub scope_id: [u8; 32],
    pub scope_value: [u8; 32],
    pub one_time: bool,
}

#[event]
pub struct ProofVerified {
    pub group: Pubkey,
    pub scope: Pubkey,
    pub receipt: Pubkey,
    pub index: u64,
    pub root: [u8; 32],
    pub nullifier: [u8; 32],
    pub message: [u8; 32],
    pub slot: u64,
}

#[error_code]
pub enum NullError {
    #[msg("Signer is not the group administrator")]
    Unauthorized,
    #[msg("Merkle root was never published for this group")]
    UnknownRoot,
    #[msg("Merkle root has been superseded for longer than the validity window")]
    StaleRoot,
    #[msg("Nullifier already consumed in this one-time scope")]
    NullifierAlreadyUsed,
    #[msg("Scope does not belong to this group")]
    ScopeGroupMismatch,
    #[msg("Public input is not a canonical scalar field element")]
    InvalidPublicInput,
    #[msg("Proof bytes are malformed")]
    MalformedProof,
    #[msg("Groth16 proof is invalid")]
    InvalidProof,
    #[msg("Arithmetic overflow")]
    Overflow,
}
