import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Roles } from '../core/decorators/roles.decorator';
import { WorkflowEngineService } from './workflow-engine.service';

@Controller('workflows')
@Roles('admin', 'super_admin')
export class WorkflowEngineController {
  constructor(private readonly workflows: WorkflowEngineService) {}
  @Get() list(@Headers('x-actor-id') actor?: string) {
    return this.workflows.list(actor);
  }
  @Post() create(
    @Body() body: Record<string, unknown>,
    @Headers('x-actor-id') actor?: string,
  ) {
    return this.workflows.create(body, actor);
  }
  @Get(':id') get(
    @Param('id') id: string,
    @Headers('x-actor-id') actor?: string,
  ) {
    return this.workflows.get(id, actor);
  }
  @Patch(':id') update(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-actor-id') actor?: string,
  ) {
    return this.workflows.update(id, body, actor);
  }
  @Delete(':id') archive(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-actor-id') actor?: string,
  ) {
    return this.workflows.archive(id, body, actor);
  }
  @Post(':id/duplicate') duplicate(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-actor-id') actor?: string,
  ) {
    return this.workflows.duplicate(id, body, actor);
  }
  @Get(':id/versions') versions(
    @Param('id') id: string,
    @Headers('x-actor-id') actor?: string,
  ) {
    return this.workflows.versions(id, actor);
  }
  @Get(':id/versions/:version') version(
    @Param('id') id: string,
    @Param('version') version: string,
    @Headers('x-actor-id') actor?: string,
  ) {
    return this.workflows.version(id, version, actor);
  }
  @Post(':id/nodes') addNode(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-actor-id') actor?: string,
  ) {
    return this.workflows.addNode(id, body, actor);
  }
  @Patch(':id/nodes/:nodeId') updateNode(
    @Param('id') id: string,
    @Param('nodeId') nodeId: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-actor-id') actor?: string,
  ) {
    return this.workflows.updateNode(id, nodeId, body, actor);
  }
  @Delete(':id/nodes/:nodeId') deleteNode(
    @Param('id') id: string,
    @Param('nodeId') nodeId: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-actor-id') actor?: string,
  ) {
    return this.workflows.deleteNode(id, nodeId, body, actor);
  }
  @Post(':id/edges') addEdge(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-actor-id') actor?: string,
  ) {
    return this.workflows.addEdge(id, body, actor);
  }
  @Delete(':id/edges/:edgeId') deleteEdge(
    @Param('id') id: string,
    @Param('edgeId') edgeId: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-actor-id') actor?: string,
  ) {
    return this.workflows.deleteEdge(id, edgeId, body, actor);
  }
  @Post(':id/validate') validate(
    @Param('id') id: string,
    @Headers('x-actor-id') actor?: string,
  ) {
    return this.workflows.validateStored(id, actor);
  }
  @Post(':id/publish') publish(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-actor-id') actor?: string,
  ) {
    return this.workflows.publishWorkflow(id, body, actor);
  }
  @Post(':id/execute') execute(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-actor-id') actor?: string,
  ) {
    return this.workflows.manualExecute(id, body, actor);
  }
  @Get(':id/executions') executions(
    @Param('id') id: string,
    @Headers('x-actor-id') actor?: string,
  ) {
    return this.workflows.executions(id, actor);
  }
  @Get(':id/audits') audits(
    @Param('id') id: string,
    @Headers('x-actor-id') actor?: string,
  ) {
    return this.workflows.audits(id, actor);
  }
}

@Controller('workflow-executions')
@Roles('admin', 'super_admin')
export class WorkflowExecutionsController {
  constructor(private readonly workflows: WorkflowEngineService) {}
  @Get(':id') get(
    @Param('id') id: string,
    @Headers('x-actor-id') actor?: string,
  ) {
    return this.workflows.execution(id, actor);
  }
  @Post(':id/retry') retry(
    @Param('id') id: string,
    @Headers('x-actor-id') actor?: string,
  ) {
    return this.workflows.retryExecution(id, actor);
  }
  @Post(':id/cancel') cancel(
    @Param('id') id: string,
    @Headers('x-actor-id') actor?: string,
  ) {
    return this.workflows.cancelExecution(id, actor);
  }
}
