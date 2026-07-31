import { PartialType } from '@nestjs/swagger';
import { CreateDocumentRequestDto } from './create-document-request.dto';

export class UpdateDocumentRequestDto extends PartialType(CreateDocumentRequestDto) {}
