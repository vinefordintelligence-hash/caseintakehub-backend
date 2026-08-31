import { InjectDataSource } from '@nestjs/typeorm';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { SubmitWithdrawalRequestDto } from './dto/submit-withdrawal-request.dto';
import { WithdrawalDecisionDto } from './dto/withdrawal-decision.dto';
import type { WorkflowView } from '../workflow/workflow.service';

type JsonResult = Record<string, unknown> | null;

interface FunctionCallRow {
  result: JsonResult;
}

export interface WithdrawalHandoffClaims {
  sub?: string;
  grant_id?: string;
  case_id?: string;
  case_number?: string;
  organization_id?: string;
  action_id?: string;
  purpose?: string;
  sandbox?: boolean;
}

@Injectable()
export class WithdrawalsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly jwtService: JwtService,
  ) {}

  private message(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return 'unknown database error';
  }

  private async call(promise: Promise<FunctionCallRow[]>): Promise<JsonResult> {
    try {
      const rows = await promise;
      return rows[0]?.result ?? null;
    } catch (error) {
      const message = this.message(error);
      if (
        message.includes('permission denied') ||
        message.includes('only administrators')
      ) {
        throw new ForbiddenException(message);
      }
      if (message.includes('not found')) {
        throw new NotFoundException(message);
      }
      if (
        message.includes('token') ||
        message.includes('authorization required')
      ) {
        throw new UnauthorizedException(message);
      }
      throw new BadRequestException(message);
    }
  }

  async submit(
    caseId: string,
    actorId: string | undefined,
    dto: SubmitWithdrawalRequestDto,
  ): Promise<JsonResult> {
    let claims: WithdrawalHandoffClaims;
    try {
      claims = this.jwtService.verify<WithdrawalHandoffClaims>(
        dto.handoff_token,
      );
    } catch {
      throw new UnauthorizedException(
        'phase 6 handoff token is invalid or expired',
      );
    }
    if (
      claims.purpose !== 'phase6_handoff' ||
      !claims.case_id ||
      claims.case_id !== caseId
    ) {
      throw new UnauthorizedException(
        'phase 6 handoff token does not authorize this case',
      );
    }
    return this.call(
      this.dataSource.query<FunctionCallRow[]>(
        `SELECT public.vf_submit_withdrawal_after_acceptance($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result`,
        [
          caseId,
          actorId ?? null,
          dto.handoff_token,
          dto.amount,
          dto.currency ?? 'USD',
          dto.requested_method ?? null,
          dto.beneficiary_name ?? null,
          dto.account_number ?? null,
          dto.account_type ?? null,
          dto.routing_number ?? null,
          dto.client_note ?? null,
        ],
      ),
    );
  }

  async findByCase(
    caseId: string,
    view: WorkflowView,
    actorId?: string,
  ): Promise<JsonResult> {
    return this.call(
      this.dataSource.query<FunctionCallRow[]>(
        `SELECT public.vf_get_case_withdrawal_requests($1,$2,$3) AS result`,
        [caseId, actorId ?? null, view ?? 'admin'],
      ),
    );
  }

  async findOne(
    id: string,
    view: WorkflowView,
    actorId?: string,
  ): Promise<JsonResult> {
    return this.call(
      this.dataSource.query<FunctionCallRow[]>(
        `SELECT public.vf_get_withdrawal_request($1,$2,$3) AS result`,
        [id, actorId ?? null, view ?? 'admin'],
      ),
    );
  }

  async list(
    actorId: string | undefined,
    status?: string,
  ): Promise<JsonResult> {
    return this.call(
      this.dataSource.query<FunctionCallRow[]>(
        `SELECT public.vf_list_withdrawal_requests($1,$2) AS result`,
        [actorId ?? null, status ?? null],
      ),
    );
  }

  async decision(
    id: string,
    actorId: string | undefined,
    dto: WithdrawalDecisionDto,
  ): Promise<JsonResult> {
    return this.call(
      this.dataSource.query<FunctionCallRow[]>(
        `SELECT public.vf_admin_withdrawal_decision($1,$2,$3,$4,$5) AS result`,
        [
          id,
          dto.decision,
          actorId ?? null,
          dto.reason ?? null,
          dto.note ?? null,
        ],
      ),
    );
  }

  async respond(
    id: string,
    actorId: string | undefined,
    response: string,
  ): Promise<JsonResult> {
    return this.call(
      this.dataSource.query<FunctionCallRow[]>(
        `SELECT public.vf_respond_to_withdrawal_request($1,$2,$3) AS result`,
        [id, actorId ?? null, response],
      ),
    );
  }

  async sendMessage(
    caseId: string,
    actorId: string | undefined,
    content: string,
  ): Promise<JsonResult> {
    return this.call(
      this.dataSource.transaction(async (manager) => {
        const rows = await manager.query<FunctionCallRow[]>(
          `SELECT public.vf_send_case_message($1,$2,$3) AS result`,
          [caseId, actorId ?? null, content],
        );
        await manager.query(
          `INSERT INTO public.case_notifications(case_id,organization_id,recipient_role,title,body)
         SELECT c.id,c.organization_id,'admin','New client message',left($2,500)
           FROM public.cases c WHERE c.id=$1`,
          [caseId, content.trim()],
        );
        return rows;
      }),
    );
  }

  async getMessages(
    caseId: string,
    view: WorkflowView,
    actorId?: string,
  ): Promise<JsonResult> {
    return this.call(
      this.dataSource.query<FunctionCallRow[]>(
        `SELECT public.vf_get_case_messages($1,$2,$3) AS result`,
        [caseId, actorId ?? null, view ?? 'admin'],
      ),
    );
  }
}
