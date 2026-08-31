import { IsIn, IsString, Matches, MaxLength } from 'class-validator';

export class CreateReportDto {
  @IsString()
  @MaxLength(64)
  @Matches(
    /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|VF-[0-9]{4}-[0-9]+)$/i,
  )
  caseId!: string;

  @IsIn([
    'case_summary',
    'investigation',
    'financial_assessment',
    'evidence',
    'workflow',
    'audit',
  ])
  type!:
    | 'case_summary'
    | 'investigation'
    | 'financial_assessment'
    | 'evidence'
    | 'workflow'
    | 'audit';

  @IsIn(['json', 'csv'])
  format: 'json' | 'csv' = 'json';
}
