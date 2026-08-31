import { ServiceUnavailableException } from '@nestjs/common';
import { DepositAddressProvider } from './deposit-address-provider';
describe('DepositAddressProvider', () => {
  it('fails closed without provider credentials and never invents an address', async () => {
    const service = new DepositAddressProvider(
      { get: jest.fn() } as never,
      { publicKey: jest.fn() } as never,
    );
    await expect(
      service.assign('algorand_testnet', 'ALGO', 'ref'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it('rejects Mainnet provider configuration', async () => {
    const service = new DepositAddressProvider(
      {
        get: jest.fn((k: string) =>
          k.endsWith('_URL') ? 'https://mainnet.provider.test' : 'secret',
        ),
      } as never,
      { publicKey: jest.fn() } as never,
    );
    await expect(
      service.assign('algorand_testnet', 'ALGO', 'ref'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it('accepts only a validated public Testnet address without custody secrets', async () => {
    const algorand = { publicKey: jest.fn() };
    const service = new DepositAddressProvider(
      { get: jest.fn() } as never,
      algorand as never,
    );
    await expect(
      service.assign('algorand_testnet', 'ALGO', 'org:account', 'A'.repeat(58)),
    ).resolves.toMatchObject({
      address: 'A'.repeat(58),
      addressType: 'non_custodial',
      provider: 'administrator_supplied_public',
    });
    expect(algorand.publicKey).toHaveBeenCalledWith('A'.repeat(58));
  });
});
