import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { AlgorandService } from './algorand.service';
import algosdk from 'algosdk';

function base32(value: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0,
    accumulator = 0,
    result = '';
  for (const byte of value) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += alphabet[(accumulator >>> bits) & 31];
    }
  }
  if (bits) result += alphabet[(accumulator << (5 - bits)) & 31];
  return result;
}

describe('AlgorandService', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('verifies a valid identity challenge and rejects tampering', () => {
    const keys = generateKeyPairSync('ed25519');
    const der = keys.publicKey.export({ format: 'der', type: 'spki' });
    const publicKey = der.subarray(der.length - 32);
    const checksum = createHash('sha512-256')
      .update(publicKey)
      .digest()
      .subarray(28);
    const address = base32(Buffer.concat([publicKey, checksum]));
    const service = new AlgorandService({
      get: jest.fn(),
    } as unknown as ConfigService);
    const challenge = '{"nonce":"identity-bound"}';
    const signature = sign(
      null,
      Buffer.concat([Buffer.from('MX'), Buffer.from(challenge)]),
      keys.privateKey,
    ).toString('base64');
    expect(service.verifyOwnership(address, challenge, signature)).toBe(true);
    expect(service.verifyOwnership(address, `${challenge}x`, signature)).toBe(
      false,
    );
  });

  it('rejects an address with an invalid checksum', () => {
    const service = new AlgorandService({
      get: jest.fn(),
    } as unknown as ConfigService);
    expect(() => service.publicKey('A'.repeat(58))).toThrow(
      BadRequestException,
    );
  });

  it('fails closed for Mainnet configuration', async () => {
    const config = {
      get: jest.fn(
        (key: string) =>
          ({
            ALGORAND_NETWORK: 'testnet',
            ALGORAND_TESTNET_INDEXER_URL: 'https://mainnet.example',
          })[key],
      ),
    };
    const service = new AlgorandService(config as unknown as ConfigService);
    await expect(
      service.lookupTransaction('A'.repeat(52)),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('sends an Algod token header only when one is configured', async () => {
    const account = algosdk.generateAccount();
    const params = {
      fee: 1,
      'min-fee': 1000,
      'last-round': 10,
      'genesis-id': 'testnet-v1.0',
      'genesis-hash': Buffer.alloc(32).toString('base64'),
    };
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => params });
    const tokenless = new AlgorandService({
      get: jest.fn(
        (key: string) =>
          ({
            ALGORAND_NETWORK: 'testnet',
            ALGORAND_TESTNET_ALGOD_URL: 'https://testnet.example',
          })[key],
      ),
    } as unknown as ConfigService);
    await tokenless.prepareOwnershipTransaction(
      account.addr.toString(),
      'challenge',
    );
    expect(global.fetch).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: {} }),
    );

    const token = new AlgorandService({
      get: jest.fn(
        (key: string) =>
          ({
            ALGORAND_NETWORK: 'testnet',
            ALGORAND_TESTNET_ALGOD_URL: 'https://testnet.example',
            ALGORAND_TESTNET_ALGOD_TOKEN: 'secret',
          })[key],
      ),
    } as unknown as ConfigService);
    await token.prepareOwnershipTransaction(
      account.addr.toString(),
      'challenge',
    );
    expect(global.fetch).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: { 'X-Algo-API-Token': 'secret' } }),
    );
  });

  it('accepts only a confirmed transaction returned for the requested id', async () => {
    const config = {
      get: jest.fn(
        (key: string) =>
          ({
            ALGORAND_NETWORK: 'testnet',
            ALGORAND_TESTNET_INDEXER_URL: 'https://testnet.example',
          })[key],
      ),
    };
    const service = new AlgorandService(config as unknown as ConfigService);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        transaction: {
          id: 'A'.repeat(52),
          sender: 'SENDER',
          'confirmed-round': 99,
          'genesis-id': 'testnet-v1.0',
          'application-transaction': {
            'application-id': 7,
            'application-args': [],
          },
        },
      }),
    });
    await expect(
      service.lookupTransaction('A'.repeat(52)),
    ).resolves.toMatchObject({ confirmedRound: 99, applicationId: '7' });
  });

  it('rejects a declared action when its ABI selector does not match', () => {
    const service = new AlgorandService({
      get: jest.fn(),
    } as unknown as ConfigService);
    expect(() =>
      service.assertEscrowMethod('release_funds', [
        Buffer.from('wrong').toString('base64'),
      ]),
    ).toThrow('ABI method does not match');
  });

  it('verifies a signed zero-value Testnet ownership transaction', () => {
    const account = algosdk.generateAccount();
    const service = new AlgorandService({
      get: jest.fn(),
    } as unknown as ConfigService);
    const challenge = '{"nonce":"one-time"}';
    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: account.addr,
      receiver: account.addr,
      amount: 0,
      note: new TextEncoder().encode(challenge),
      suggestedParams: {
        fee: 1000n,
        minFee: 1000n,
        firstValid: 1n,
        lastValid: 20n,
        genesisID: 'testnet-v1.0',
        genesisHash: Buffer.alloc(32),
        flatFee: true,
      },
    });
    const signed = Buffer.from(txn.signTxn(account.sk)).toString('base64');
    expect(
      service.verifySignedOwnershipTransaction(
        account.addr.toString(),
        challenge,
        signed,
      ),
    ).toBe(true);
    expect(
      service.verifySignedOwnershipTransaction(
        account.addr.toString(),
        `${challenge}x`,
        signed,
      ),
    ).toBe(false);
  });

  it('rejects unconfirmed indexer data', async () => {
    const config = {
      get: jest.fn(
        (key: string) =>
          ({
            ALGORAND_NETWORK: 'testnet',
            ALGORAND_TESTNET_INDEXER_URL: 'https://testnet.example',
          })[key],
      ),
    };
    const service = new AlgorandService(config as unknown as ConfigService);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        transaction: { id: 'A'.repeat(52), sender: 'SENDER' },
      }),
    });
    await expect(service.lookupTransaction('A'.repeat(52))).rejects.toThrow(
      'not confirmed',
    );
  });

  it('discovers only confirmed incoming Testnet ALGO payments for an address', async () => {
    const account = algosdk.generateAccount();
    const address = account.addr.toString();
    const config = {
      get: jest.fn(
        (key: string) =>
          ({
            ALGORAND_NETWORK: 'testnet',
            ALGORAND_TESTNET_INDEXER_URL: 'https://testnet.example',
          })[key],
      ),
    };
    const service = new AlgorandService(config as unknown as ConfigService);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        transactions: [
          {
            id: 'A'.repeat(52),
            sender: 'SENDER',
            'confirmed-round': 99,
            'genesis-id': 'testnet-v1.0',
            'payment-transaction': { receiver: address, amount: 1_000_000 },
          },
          {
            id: 'B'.repeat(52),
            sender: 'SENDER',
            'confirmed-round': 99,
            'genesis-id': 'mainnet-v1.0',
            'payment-transaction': { receiver: address, amount: 1_000_000 },
          },
          {
            id: 'C'.repeat(52),
            sender: 'SENDER',
            'confirmed-round': 99,
            'genesis-id': 'testnet-v1.0',
            'payment-transaction': { receiver: 'OTHER', amount: 1_000_000 },
          },
        ],
      }),
    });
    await expect(service.lookupIncomingPayments(address)).resolves.toEqual([
      expect.objectContaining({
        transactionHash: 'A'.repeat(52),
        receiver: address,
        amount: 1_000_000,
      }),
    ]);
  });
});
