import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  Request,
  BadRequestException,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { AnimalsService } from './animals.service';
import * as fs from 'fs';
import * as path from 'path';

@Controller('api/animals')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class AnimalsController {
  constructor(private animalsService: AnimalsService) {}

  @Get()
  findAll(
    @Query('eventId') eventId?: string,
    @Query('animalType') animalType?: string,
    @Query('status') status?: string,
  ) {
    return this.animalsService.findAll(eventId, animalType, status);
  }

  // ─── Static routes BEFORE :id ───────────────────────────────────────────────

  @Post('generate')
  @Roles(Role.SUPER_ADMIN, Role.KETUA_PANITIA)
  generate(@Body() body: { eventId: string }) {
    if (!body.eventId) {
      throw new BadRequestException('eventId wajib diisi');
    }
    return this.animalsService.generateFromRegistrations(body.eventId);
  }

  @Post('vendor')
  @Roles(Role.SUPER_ADMIN, Role.KETUA_PANITIA)
  createVendor(
    @Body() body: { eventId: string; animalType: string; notes?: string },
  ) {
    if (!body.eventId || !body.animalType) {
      throw new BadRequestException('eventId dan animalType wajib diisi');
    }
    return this.animalsService.createVendorAnimal(
      body.eventId,
      body.animalType,
      body.notes,
    );
  }

  @Get('card-pdf')
  @Roles(Role.SUPER_ADMIN, Role.KETUA_PANITIA, Role.PANITIA_VOUCHER)
  async downloadCardPdf(
    @Query('ids') idsParam?: string,
    @Query('eventId') eventId?: string,
    @Res() res?: Response,
  ) {
    const ids = idsParam ? idsParam.split(',').filter(Boolean) : undefined;
    if (!ids?.length && !eventId) {
      throw new BadRequestException('ids atau eventId harus diisi');
    }
    const buffer = await this.animalsService.generateCardPdf(ids, eventId);
    res!.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=animal-cards.pdf`,
      'Content-Length': buffer.length,
    });
    res!.end(buffer);
  }

  @Get('scan/:code')
  findByCode(@Param('code') code: string) {
    return this.animalsService.findByCode(code);
  }

  // ─── :id routes ─────────────────────────────────────────────────────────────

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.animalsService.findById(id);
  }

  @Post(':id/receive')
  @Roles(Role.SUPER_ADMIN, Role.KETUA_PANITIA, Role.PANITIA_SCANNER)
  receive(
    @Param('id') id: string,
    @Body() body: { notes?: string },
    @Request() req: any,
  ) {
    return this.animalsService.receive(id, req.user.id, body.notes);
  }

  @Post(':id/photo')
  @Roles(Role.SUPER_ADMIN, Role.KETUA_PANITIA, Role.PANITIA_SCANNER)
  @UseInterceptors(
    FileInterceptor('photo', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  async uploadPhoto(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('File foto wajib diisi');

    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    const dir = path.join(uploadDir, 'animal-photos');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const filename = `${id}-${Date.now()}${path.extname(file.originalname)}`;
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, file.buffer);

    return this.animalsService.addPhoto(id, filename);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.KETUA_PANITIA)
  remove(@Param('id') id: string) {
    return this.animalsService.remove(id);
  }
}
