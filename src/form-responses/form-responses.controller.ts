import {
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FormResponse } from './form-response.entity';
import { Pengkurban } from '../pengkurban/pengkurban.entity';
import { FormResponsesService } from './form-responses.service';
import { buildPrefillUrl } from './mappers';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';

@Controller('api/form-responses')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.KETUA_PANITIA, Role.PANITIA_VOUCHER)
export class FormResponsesController {
  constructor(
    @InjectRepository(FormResponse)
    private readonly formRepo: Repository<FormResponse>,
    @InjectRepository(Pengkurban)
    private readonly pengkurbanRepo: Repository<Pengkurban>,
    private readonly service: FormResponsesService,
  ) {}

  @Get()
  async getOne(
    @Query('pengkurban_id') pengkurbanId: string,
    @Query('form_key') formKey: string,
  ) {
    if (!pengkurbanId || !formKey) {
      throw new BadRequestException('pengkurban_id and form_key are required');
    }

    const response = await this.formRepo.findOne({
      where: { pengkurbanId, formKey },
    });

    if (response) {
      return {
        submitted: true,
        form_submitted_at: response.formSubmittedAt,
        synced_at: response.syncedAt,
        data: response.data,
      };
    }

    const pengkurban = await this.pengkurbanRepo.findOne({
      where: { id: pengkurbanId },
    });
    if (!pengkurban) {
      throw new NotFoundException('Pengkurban tidak ditemukan');
    }

    let prefillUrl: string | null = null;
    if (formKey === process.env.KONFIRMASI_TEKNIS_FORM_KEY) {
      try {
        const namaWithReg = `${pengkurban.name} (${pengkurban.registrationNumber})`;
        prefillUrl = buildPrefillUrl(namaWithReg);
      } catch (e) {
        const err = e as Error;
        console.error('[form-responses prefill]', err.stack || err.message);
        prefillUrl = null;
      }
    }

    return { submitted: false, prefill_url: prefillUrl };
  }

  @Post('sync-now')
  async syncNow(@Query('form_key') formKey: string) {
    if (!formKey) {
      throw new BadRequestException('form_key required');
    }
    if (formKey !== process.env.KONFIRMASI_TEKNIS_FORM_KEY) {
      throw new BadRequestException('unknown form_key');
    }
    const sheetId = process.env.KONFIRMASI_TEKNIS_SHEET_ID;
    const range = process.env.KONFIRMASI_TEKNIS_RANGE;
    if (!sheetId || !range) {
      throw new ServiceUnavailableException(
        'Form ingestion not configured: KONFIRMASI_TEKNIS_SHEET_ID or KONFIRMASI_TEKNIS_RANGE missing',
      );
    }
    return this.service.syncFromSheet(formKey, sheetId, range);
  }
}
