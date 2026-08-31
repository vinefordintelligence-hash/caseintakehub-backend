import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createPublicKey, verify } from 'node:crypto';
import algosdk from 'algosdk';
import { requestUpstream } from '../core/gateway/upstream-request';

export type VerifiedAlgorandTransaction = {
  transactionHash: string;
  confirmedRound: number;
  sender: string;
  receiver: string | null;
  amount: number | null;
  assetId: string | null;
  applicationId: string | null;
  applicationArgs: string[];
  rawPayload: Record<string, unknown>;
};

@Injectable()
export class AlgorandService {
  private readonly methods: Record<string, string> = {
    create_grant: 'CreateGrant(byte[],address,uint64,uint64)void',
    fund_grant: 'FundGrant(pay)void',
    submit_milestone_reference: 'SubmitMilestoneReference(byte[])void',
    vote: 'Vote(bool,uint64)void',
    release_funds: 'ReleaseFunds(uint64)void',
    challenge: 'Challenge()void',
    pause: 'Pause(bool)void',
  };
  constructor(private readonly config: ConfigService) {}

  publicKey(address: string): Buffer {
    const decoded = this.base32(address);
    if (decoded.length !== 36)
      throw new BadRequestException('invalid Algorand address');
    const key = decoded.subarray(0, 32);
    const checksum = createHash('sha512-256').update(key).digest().subarray(28);
    if (!checksum.equals(decoded.subarray(32)))
      throw new BadRequestException('invalid Algorand address checksum');
    return key;
  }

  verifyOwnership(
    address: string,
    challenge: string,
    signatureBase64: string,
  ): boolean {
    const signature = Buffer.from(signatureBase64, 'base64');
    if (signature.length !== 64) return false;
    const spki = Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      this.publicKey(address),
    ]);
    const domainSeparated = Buffer.concat([
      Buffer.from('MX', 'ascii'),
      Buffer.from(challenge, 'utf8'),
    ]);
    return verify(
      null,
      domainSeparated,
      createPublicKey({ key: spki, format: 'der', type: 'spki' }),
      signature,
    );
  }

  async prepareOwnershipTransaction(
    address: string,
    challenge: string,
  ): Promise<string> {
    this.publicKey(address);
    const algodUrl = this.testnetUrl(
      'ALGORAND_TESTNET_ALGOD_URL',
      'Algorand Testnet node',
    );
    let response: Response;
    try {
      response = await requestUpstream(`${algodUrl}/v2/transactions/params`, {
        headers: this.optionalTokenHeader(
          'ALGORAND_TESTNET_ALGOD_TOKEN',
          'X-Algo-API-Token',
        ),
        cache: 'no-store',
      });
    } catch {
      throw new ServiceUnavailableException(
        'Algorand Testnet node is unavailable',
      );
    }
    if (!response.ok)
      throw new ServiceUnavailableException(
        'Algorand Testnet transaction parameters are unavailable',
      );
    const params = (await response.json()) as Record<string, any>;
    if (params['genesis-id'] !== 'testnet-v1.0')
      throw new ServiceUnavailableException('Algorand node is not Testnet');
    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: address,
      receiver: address,
      amount: 0,
      note: new TextEncoder().encode(challenge),
      suggestedParams: {
        fee: BigInt(params.fee),
        minFee: BigInt(params['min-fee']),
        firstValid: BigInt(params['last-round']),
        lastValid: BigInt(params['last-round']) + 20n,
        genesisID: params['genesis-id'],
        genesisHash: Buffer.from(params['genesis-hash'], 'base64'),
        flatFee: false,
      },
    });
    return Buffer.from(txn.toByte()).toString('base64');
  }

  verifySignedOwnershipTransaction(
    address: string,
    challenge: string,
    signedBase64: string,
  ): boolean {
    try {
      const signed = algosdk.decodeSignedTransaction(
        Buffer.from(signedBase64, 'base64'),
      );
      const txn = signed.txn;
      if (
        !signed.sig ||
        signed.msig ||
        signed.lsig ||
        signed.sgnr ||
        txn.type !== algosdk.TransactionType.pay ||
        txn.sender.toString() !== address ||
        txn.payment?.receiver.toString() !== address ||
        txn.payment.amount !== 0n ||
        txn.payment.closeRemainderTo ||
        txn.rekeyTo ||
        txn.genesisID !== 'testnet-v1.0' ||
        Buffer.from(txn.note).toString('utf8') !== challenge
      )
        return false;
      const spki = Buffer.concat([
        Buffer.from('302a300506032b6570032100', 'hex'),
        this.publicKey(address),
      ]);
      return verify(
        null,
        txn.bytesToSign(),
        createPublicKey({ key: spki, format: 'der', type: 'spki' }),
        signed.sig,
      );
    } catch {
      return false;
    }
  }

  contractManifest(): Record<string, unknown> {
    return {
      network: 'algorand_testnet',
      genesisId: 'testnet-v1.0',
      methods: this.methods,
    };
  }

  assertEscrowMethod(type: string, applicationArgs: string[]): void {
    const signature = this.methods[type];
    if (!signature) throw new BadRequestException('unsupported escrow method');
    const selector = createHash('sha512-256')
      .update(signature)
      .digest()
      .subarray(0, 4);
    if (
      !applicationArgs[0] ||
      !Buffer.from(applicationArgs[0], 'base64').equals(selector)
    )
      throw new BadRequestException(
        'transaction ABI method does not match the declared escrow action',
      );
  }

  async lookupTransaction(txid: string): Promise<VerifiedAlgorandTransaction> {
    if (!/^[A-Z2-7]{52}$/.test(txid))
      throw new BadRequestException('invalid Algorand transaction id');
    const url = this.testnetUrl(
      'ALGORAND_TESTNET_INDEXER_URL',
      'Algorand Testnet indexer',
    );
    const token = this.config.get<string>('ALGORAND_TESTNET_INDEXER_TOKEN');
    let response: Response;
    try {
      response = await requestUpstream(`${url}/v2/transactions/${txid}`, {
        headers: token ? { 'X-Indexer-API-Token': token } : {},
        cache: 'no-store',
      });
    } catch {
      throw new ServiceUnavailableException(
        'Algorand Testnet indexer is unavailable',
      );
    }
    if (!response.ok)
      throw new BadRequestException(
        'transaction was not found on Algorand Testnet',
      );
    const payload = (await response.json()) as Record<string, any>;
    const transaction = payload.transaction;
    if (
      !transaction ||
      transaction.id !== txid ||
      !Number.isSafeInteger(transaction['confirmed-round']) ||
      transaction['confirmed-round'] <= 0
    )
      throw new BadRequestException(
        'transaction is not confirmed on Algorand Testnet',
      );
    if (transaction['genesis-id'] !== 'testnet-v1.0')
      throw new BadRequestException('transaction is not from Algorand Testnet');
    const payment = transaction['payment-transaction'];
    const asset = transaction['asset-transfer-transaction'];
    const app = transaction['application-transaction'];
    return {
      transactionHash: txid,
      confirmedRound: transaction['confirmed-round'],
      sender: transaction.sender,
      receiver: payment?.receiver ?? asset?.receiver ?? null,
      amount: payment?.amount ?? asset?.amount ?? null,
      assetId: asset?.['asset-id'] != null ? String(asset['asset-id']) : null,
      applicationId:
        app?.['application-id'] != null ? String(app['application-id']) : null,
      applicationArgs: Array.isArray(app?.['application-args'])
        ? app['application-args']
        : [],
      rawPayload: payload,
    };
  }

  async lookupIncomingPayments(
    address: string,
  ): Promise<VerifiedAlgorandTransaction[]> {
    this.publicKey(address);
    const url = this.testnetUrl(
      'ALGORAND_TESTNET_INDEXER_URL',
      'Algorand Testnet indexer',
    );
    const token = this.config.get<string>('ALGORAND_TESTNET_INDEXER_TOKEN');
    let response: Response;
    try {
      response = await requestUpstream(
        `${url}/v2/accounts/${address}/transactions?tx-type=pay&limit=100`,
        {
          headers: token ? { 'X-Indexer-API-Token': token } : {},
          cache: 'no-store',
        },
      );
    } catch {
      throw new ServiceUnavailableException(
        'Algorand Testnet indexer is unavailable',
      );
    }
    if (!response.ok)
      throw new ServiceUnavailableException(
        'Algorand Testnet address monitoring is unavailable',
      );
    const payload = (await response.json()) as Record<string, any>;
    if (!Array.isArray(payload.transactions))
      throw new ServiceUnavailableException(
        'invalid Algorand Testnet indexer response',
      );
    return payload.transactions
      .filter(
        (transaction: Record<string, any>) =>
          typeof transaction.id === 'string' &&
          /^[A-Z2-7]{52}$/.test(transaction.id) &&
          transaction['genesis-id'] === 'testnet-v1.0' &&
          Number.isSafeInteger(transaction['confirmed-round']) &&
          transaction['confirmed-round'] > 0 &&
          transaction['payment-transaction']?.receiver === address &&
          Number.isSafeInteger(transaction['payment-transaction']?.amount) &&
          transaction['payment-transaction'].amount > 0,
      )
      .map((transaction: Record<string, any>) => ({
        transactionHash: transaction.id,
        confirmedRound: transaction['confirmed-round'],
        sender: transaction.sender,
        receiver: transaction['payment-transaction'].receiver,
        amount: transaction['payment-transaction'].amount,
        assetId: null,
        applicationId: null,
        applicationArgs: [],
        rawPayload: { transaction },
      }));
  }

  private testnetUrl(key: string, label: string): string {
    const network = this.config.get<string>('ALGORAND_NETWORK');
    const url = this.config.get<string>(key);
    if (network !== 'testnet' || !url)
      throw new ServiceUnavailableException(`${label} is not configured`);
    if (/mainnet/i.test(url))
      throw new ServiceUnavailableException(
        'Mainnet Algorand configuration is prohibited',
      );
    return url.replace(/\/$/, '');
  }

  private optionalTokenHeader(
    key: string,
    header: string,
  ): Record<string, string> {
    const token = this.config.get<string>(key);
    return token ? { [header]: token } : {};
  }

  private base32(value: string): Buffer {
    if (!/^[A-Z2-7]{58}$/.test(value))
      throw new BadRequestException('invalid Algorand address');
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0,
      accumulator = 0;
    const bytes: number[] = [];
    for (const character of value) {
      accumulator = (accumulator << 5) | alphabet.indexOf(character);
      bits += 5;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((accumulator >>> bits) & 255);
      }
    }
    return Buffer.from(bytes);
  }
}
