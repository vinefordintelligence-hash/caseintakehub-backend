import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { FeeDefinition } from './fee-definition.entity';
import { FeeComponent } from './fee-component.entity';
import { FeeSnapshot } from './fee-snapshot.entity';
import { VerifiedIdentity } from '../identity/supabase-identity.service';

@Injectable()
export class FeeConfigurationService {
  constructor(
    @InjectRepository(FeeDefinition)
    private readonly defRepo: Repository<FeeDefinition>,
    @InjectRepository(FeeComponent)
    private readonly compRepo: Repository<FeeComponent>,
    @InjectRepository(FeeSnapshot)
    private readonly snapRepo: Repository<FeeSnapshot>,
  ) {}

  async listDefinitions(identity: VerifiedIdentity) {
    return this.defRepo.find({
      where: { organizationId: identity.organizationId },
    });
  }

  async getDefinition(definitionId: string, organizationId: string) {
    const def = await this.defRepo.findOne({
      where: { id: definitionId, organizationId },
      relations: ['components'],
    });
    if (!def) throw new NotFoundException('fee definition not found');
    return def;
  }

  async updateDefinition(
    definitionId: string,
    organizationId: string,
    dto: {
      name?: string;
      purpose?: string;
      currency?: string;
      vatRate?: string;
      isActive?: boolean;
    },
    actorId: string,
  ) {
    const def = await this.defRepo.findOneBy({
      id: definitionId,
      organizationId,
    });
    if (!def) throw new NotFoundException('fee definition not found');
    Object.assign(def, { ...dto, updatedBy: actorId });
    return this.defRepo.save(def);
  }

  async updateComponent(
    definitionId: string,
    componentId: string,
    organizationId: string,
    dto: {
      name?: string;
      type?: 'FIXED' | 'PERCENT';
      value?: string;
      isVatable?: boolean;
      ordering?: number;
      isActive?: boolean;
    },
  ) {
    const comp = await this.compRepo.findOne({
      where: { id: componentId, definitionId },
      relations: ['definition'],
    });
    if (!comp || comp.definition.organizationId !== organizationId)
      throw new NotFoundException('fee component not found');
    Object.assign(comp, dto);
    return this.compRepo.save(comp);
  }

  async create(
    dto: { name: string; purpose: string; currency: string; vatRate: string },
    identity: VerifiedIdentity,
  ) {
    const def = this.defRepo.create({
      ...dto,
      organizationId: identity.organizationId,
      createdBy: identity.actorId,
    });
    return this.defRepo.save(def);
  }

  async addComponent(
    definitionId: string,
    dto: {
      name: string;
      type: 'FIXED' | 'PERCENT';
      value: string;
      isVatable: boolean;
      ordering: number;
    },
  ) {
    const def = await this.defRepo.findOneBy({ id: definitionId });
    if (!def) throw new NotFoundException('fee definition not found');
    const comp = this.compRepo.create({
      ...dto,
      definitionId,
    });
    return this.compRepo.save(comp);
  }

  async calculate(definitionId: string, baseAmount: string) {
    const def = await this.defRepo.findOneBy({ id: definitionId });
    if (!def) throw new NotFoundException('fee definition not found');
    const components = await this.compRepo.findBy({ definitionId });
    components.sort((a, b) => a.ordering - b.ordering);

    const baseCents = this.parseNumeric(baseAmount);
    let subtotalCents = 0n;
    let taxableSubtotalCents = 0n;
    const computedComponents: any[] = [];

    for (const comp of components) {
      let amountCents = 0n;
      if (comp.type === 'FIXED') {
        amountCents = this.parseNumeric(comp.value);
      } else {
        // comp.value is percentage, e.g., 5.00 -> 500
        const percentCents = this.parseNumeric(comp.value);
        amountCents = (baseCents * percentCents) / 10000n;
      }
      subtotalCents += amountCents;
      if (comp.isVatable) {
        taxableSubtotalCents += amountCents;
      }
      computedComponents.push({
        ...comp,
        computedValue: (Number(amountCents) / 100).toFixed(2),
      });
    }

    // def.vatRate e.g., 0.0750 -> 750
    // To parse 0.0750, need to handle more decimals than 2.
    const vatRateCents = BigInt(Math.round(parseFloat(def.vatRate) * 10000));
    const vatCents = (taxableSubtotalCents * vatRateCents) / 10000n;
    const totalCents = subtotalCents + vatCents;

    return {
      components: computedComponents,
      vatAmount: (Number(vatCents) / 100).toFixed(2),
      subtotal: (Number(subtotalCents) / 100).toFixed(2),
      total: (Number(totalCents) / 100).toFixed(2),
      currency: def.currency,
    };
  }

  async createSnapshot(
    operationId: string,
    definitionId: string,
    baseAmount: string,
    m: EntityManager,
  ) {
    const result = await this.calculate(definitionId, baseAmount);
    const snapshot = m.create(FeeSnapshot, {
      operationId,
      snapshotJson: {
        definitionId,
        baseAmount,
        ...result,
      },
    });
    return m.save(snapshot);
  }

  private parseNumeric(value: string): bigint {
    const [integer, decimal] = value.split('.');
    const intPart = BigInt(integer) * 100n;
    const decPart = BigInt((decimal + '00').slice(0, 2));
    return intPart + decPart;
  }
}
