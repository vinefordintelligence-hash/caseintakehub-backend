import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class HealthService {
  constructor(
    @InjectDataSource() private readonly data: DataSource,
    private readonly config: ConfigService,
  ) {}

  live() {
    return { status: 'ok', service: 'vineford-backend' };
  }

  async ready() {
    try {
      await this.data.query('SELECT 1');
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException('service is not ready');
    }
  }

  async dependencies() {
    let database = false;
    try {
      await this.data.query('SELECT 1');
      database = true;
    } catch {
      database = false;
    }
    return {
      status: database ? 'ready' : 'degraded',
      database,
      supabaseIdentityConfigured: Boolean(
        this.config.get('SUPABASE_URL') && this.config.get('SUPABASE_ANON_KEY'),
      ),
      storageConfigured: Boolean(this.config.get('STORAGE_PROVIDER')),
      arkCaseConfigured: false,
    };
  }
}
