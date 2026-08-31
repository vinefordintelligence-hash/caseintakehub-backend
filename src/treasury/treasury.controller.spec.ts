import { FEATURE_POLICY } from '../funding/funding-feature.guard';
import { TreasuryController } from './treasury.controller';
describe('TreasuryController authorization boundary', () => {
  it('gates every real deposit and withdrawal capability on wallet connections', () => {
    for (const method of [
      'overview',
      'assign',
      'addresses',
      'deposits',
      'verify',
      'scan',
      'requestWithdrawal',
      'withdrawals',
      'approve',
      'execute',
    ])
      expect(
        Reflect.getMetadata(
          FEATURE_POLICY,
          TreasuryController.prototype[method as keyof TreasuryController],
        ),
      ).toEqual(['walletConnectionsEnabled']);
  });
});
