import {
  IsString,
  IsEnum,
  IsOptional,
  IsNumber,
  Matches,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AnimalType } from '../../common/enums/animal-type.enum';
import { PurchaseType } from '../../common/enums/purchase-type.enum';
import { RegistrationStatus } from '../../common/enums/registration-status.enum';

export class CreatePengkurbanDto {
  @IsString()
  eventId: string;

  @IsString()
  name: string;

  @IsString()
  address: string;

  @IsEnum(AnimalType)
  animalType: AnimalType;

  @IsEnum(PurchaseType)
  purchaseType: PurchaseType;

  @IsOptional()
  @IsString()
  animalSize?: string;

  @IsOptional()
  @IsString()
  shohibulName?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  price?: number;

  @IsOptional()
  @IsString()
  @Matches(/^(08[0-9]{8,11}|\+[1-9][0-9]{9,14})$/, {
    message:
      'Nomor HP tidak valid. Gunakan format 08... (10-13 digit) atau +<kode negara>...',
  })
  phone?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsEnum(RegistrationStatus)
  status?: RegistrationStatus;

  // Override default infaq_amount. null = waiver (skip dari rekap).
  // Undefined = pakai default getInfaqAmount(animalType).
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  @Type(() => Number)
  infaqAmount?: number | null;
}

export class UpdatePengkurbanDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsEnum(AnimalType)
  animalType?: AnimalType;

  @IsOptional()
  @IsEnum(PurchaseType)
  purchaseType?: PurchaseType;

  @IsOptional()
  @IsString()
  animalSize?: string;

  @IsOptional()
  @IsString()
  shohibulName?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  price?: number;

  @IsOptional()
  @IsString()
  @Matches(/^(08[0-9]{8,11}|\+[1-9][0-9]{9,14})$/, {
    message:
      'Nomor HP tidak valid. Gunakan format 08... (10-13 digit) atau +<kode negara>...',
  })
  phone?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsEnum(RegistrationStatus)
  status?: RegistrationStatus;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  @Type(() => Number)
  infaqAmount?: number | null;
}
