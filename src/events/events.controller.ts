import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { EventsService } from './events.service';

@Controller('api/events')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class EventsController {
  constructor(private eventsService: EventsService) {}

  @Get()
  findAll() {
    return this.eventsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.eventsService.findById(id);
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.KETUA_PANITIA)
  create(@Body() body: any) {
    return this.eventsService.create(body);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.KETUA_PANITIA)
  update(@Param('id') id: string, @Body() body: any) {
    return this.eventsService.update(id, body);
  }

  @Post(':id/logo')
  @Roles(Role.SUPER_ADMIN, Role.KETUA_PANITIA)
  @UseInterceptors(
    FileInterceptor('logo', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  uploadLogo(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.eventsService.uploadLogo(id, file);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN)
  delete(@Param('id') id: string) {
    return this.eventsService.delete(id);
  }
}
