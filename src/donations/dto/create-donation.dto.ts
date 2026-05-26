import { IsString, IsOptional, IsNumber, Min, Matches } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class CreateDonationDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/[^\d+]/g, '') : value,
  )
  @Matches(/^(08[0-9]{8,11}|\+[1-9][0-9]{9,14})$/, {
    message:
      'Nomor HP tidak valid. Gunakan format 08... (10-13 digit) atau +<kode negara>...',
  })
  phone?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  @Transform(({ value }) =>
    value === '' || value === null || value === undefined
      ? undefined
      : Number(value),
  )
  amount?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  eventId?: string;
}
