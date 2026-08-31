import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AlgorandService } from '../funding/algorand.service';
import { requestUpstream } from '../core/gateway/upstream-request';

export type DepositAddressAssignment = {
  address: string;
  addressType: 'provider_managed' | 'non_custodial';
  provider: string;
  reference: string;
  metadata: Record<string, unknown>;
};

@Injectable()
export class DepositAddressProvider {
  constructor(
    private readonly config: ConfigService,
    private readonly algorand: AlgorandService,
  ) {}
  async assign(
    network: string,
    asset: string,
    externalReference: string,
    publicAddress?: string,
  ): Promise<DepositAddressAssignment> {
    if (network !== 'algorand_testnet' || asset !== 'ALGO')
      throw new BadRequestException('unsupported deposit network/asset');
    if (publicAddress) {
      this.algorand.publicKey(publicAddress);
      return {
        address: publicAddress,
        addressType: 'non_custodial',
        provider: 'administrator_supplied_public',
        reference: `${externalReference}:${publicAddress}`,
        metadata: { network: 'algorand_testnet', custody: 'external' },
      };
    }
    const url = this.config.get<string>('TREASURY_DEPOSIT_PROVIDER_URL');
    const token = this.config.get<string>('TREASURY_DEPOSIT_PROVIDER_TOKEN');
    if (!url || !token)
      throw new ServiceUnavailableException(
        'Testnet deposit address provider is not configured',
      );
    if (/mainnet/i.test(url))
      throw new ServiceUnavailableException(
        'Mainnet deposit providers are prohibited',
      );
    let response: Response;
    try {
      response = await requestUpstream(
        `${url.replace(/\/$/, '')}/v1/deposit-addresses`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            network,
            asset,
            external_reference: externalReference,
          }),
        },
      );
    } catch {
      throw new ServiceUnavailableException(
        'deposit address provider unavailable',
      );
    }
    if (!response.ok)
      throw new ServiceUnavailableException(
        'deposit address provider rejected assignment',
      );
    const data = (await response.json()) as Record<string, unknown>;
    if (typeof data.address !== 'string' || typeof data.reference !== 'string')
      throw new ServiceUnavailableException('invalid provider assignment');
    this.algorand.publicKey(data.address);
    return {
      address: data.address,
      addressType: 'provider_managed',
      reference: data.reference,
      provider: 'external_custody',
      metadata: {},
    };
  }
}
