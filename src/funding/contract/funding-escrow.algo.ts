import type { bytes, uint64 } from '@algorandfoundation/algorand-typescript';
import { Account, assert, BoxMap, Contract, Global, GlobalState, gtxn, itxn, Txn, Uint64 } from '@algorandfoundation/algorand-typescript';
import { abimethod } from '@algorandfoundation/algorand-typescript/arc4';

/** Testnet reference escrow. The application account, never Vineford, holds funds. */
export class VinefordFundingEscrow extends Contract {
  creator = GlobalState<Account>();
  recipient = GlobalState<Account>();
  grantId = GlobalState<bytes>();
  milestoneReference = GlobalState<bytes>();
  committedAmount = GlobalState<uint64>({ initialValue: Uint64(0) });
  approvalThreshold = GlobalState<uint64>({ initialValue: Uint64(1) });
  approvals = GlobalState<uint64>({ initialValue: Uint64(0) });
  challengeEndsAt = GlobalState<uint64>({ initialValue: Uint64(0) });
  status = GlobalState<uint64>({ initialValue: Uint64(0) });
  paused = GlobalState<uint64>({ initialValue: Uint64(0) });
  reviewerVotes = BoxMap<Account, uint64>({ keyPrefix: 'reviewer_vote' });

  @abimethod({ onCreate: 'require' })
  CreateGrant(grantId: bytes, recipient: Account, amount: uint64, approvalThreshold: uint64): void {
    assert(amount > Uint64(0), 'amount must be positive');
    assert(approvalThreshold > Uint64(0), 'approval threshold must be positive');
    this.creator.value = Txn.sender;
    this.recipient.value = recipient;
    this.grantId.value = grantId;
    this.committedAmount.value = amount;
    this.approvalThreshold.value = approvalThreshold;
    this.status.value = Uint64(1);
  }

  FundGrant(payment: gtxn.PaymentTxn): void {
    this.assertActive();
    assert(payment.sender === this.creator.value, 'only creator may fund');
    assert(payment.receiver === Global.currentApplicationAddress, 'payment must fund application account');
    assert(payment.amount === this.committedAmount.value, 'funding amount mismatch');
    this.status.value = Uint64(2);
  }

  SubmitMilestoneReference(reference: bytes): void {
    this.assertActive();
    assert(Txn.sender === this.recipient.value, 'only recipient may submit');
    assert(this.status.value === Uint64(2), 'grant is not funded');
    this.milestoneReference.value = reference;
    this.approvals.value = Uint64(0);
    this.status.value = Uint64(3);
  }

  Vote(approve: boolean, challengeEndsAt: uint64): void {
    this.assertActive();
    assert(Txn.sender !== this.creator.value, 'creator may not independently approve');
    assert(Txn.sender !== this.recipient.value, 'recipient may not review own milestone');
    assert(this.status.value === Uint64(3), 'milestone is not under review');
    assert(!this.reviewerVotes(Txn.sender).exists, 'reviewer already voted');
    this.reviewerVotes(Txn.sender).value = approve ? Uint64(1) : Uint64(0);
    if (approve) this.approvals.value = this.approvals.value + Uint64(1);
    if (this.approvals.value >= this.approvalThreshold.value) {
      assert(challengeEndsAt >= Global.latestTimestamp, 'invalid challenge period');
      this.challengeEndsAt.value = challengeEndsAt;
      this.status.value = Uint64(4);
    }
  }

  ReleaseFunds(amount: uint64): void {
    this.assertActive();
    assert(Txn.sender === this.creator.value, 'only creator may authorize release');
    assert(this.status.value === Uint64(4), 'approval threshold not reached');
    assert(Global.latestTimestamp >= this.challengeEndsAt.value, 'challenge period remains open');
    assert(amount === this.committedAmount.value, 'release amount mismatch');
    itxn.payment({ receiver: this.recipient.value, amount, fee: Uint64(0) }).submit();
    this.status.value = Uint64(5);
  }

  Challenge(): void {
    this.assertActive();
    assert(this.status.value === Uint64(4), 'grant is not challengeable');
    assert(Global.latestTimestamp < this.challengeEndsAt.value, 'challenge period has ended');
    this.status.value = Uint64(6);
  }

  Pause(paused: boolean): void {
    assert(Txn.sender === this.creator.value, 'only creator may pause');
    this.paused.value = paused ? Uint64(1) : Uint64(0);
  }

  private assertActive(): void {
    assert(this.paused.value === Uint64(0), 'escrow is paused');
  }
}
