import { Global, Module } from "@nestjs/common";
import {
  WorkflowEngineController,
  WorkflowExecutionsController,
} from "./workflow-engine.controller";
import { CommonModule } from "../common/common.module";
import { WorkflowEngineService } from "./workflow-engine.service";

@Global()
@Module({
  imports: [CommonModule],
  controllers: [WorkflowEngineController, WorkflowExecutionsController],
  providers: [WorkflowEngineService],
  exports: [WorkflowEngineService],
})
export class WorkflowEngineModule {}
