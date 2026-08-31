import { ArrayUnique, IsArray, IsIn } from 'class-validator';
import { PERMISSION_DEFINITIONS, PermissionName } from '../permissions.service';

export class UpdatePermissionDto {
  @IsArray()
  @ArrayUnique()
  @IsIn(PERMISSION_DEFINITIONS, { each: true })
  permissions!: PermissionName[];
}
