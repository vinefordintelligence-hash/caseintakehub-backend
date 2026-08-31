import { PartialType } from '@nestjs/swagger';
import { CreateTaskDto } from './create-task.dto';
import { IsIn, IsOptional } from 'class-validator';

export class UpdateTaskDto extends PartialType(CreateTaskDto) {
  @IsOptional()
  @IsIn([
    'pending',
    'in_progress',
    'waiting_on_client',
    'completed',
    'cancelled',
  ])
  status?: string;
}
