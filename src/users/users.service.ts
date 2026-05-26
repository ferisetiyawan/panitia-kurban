import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './user.entity';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  async findAll(): Promise<User[]> {
    return this.usersRepository.find({
      order: { createdAt: 'DESC' },
      select: ['id', 'username', 'fullName', 'role', 'isActive', 'createdAt'],
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { id } });
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { username } });
  }

  async findByResetToken(token: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { resetToken: token } });
  }

  async updateResetToken(
    id: string,
    token: string | null,
    expires: Date | null,
  ) {
    const user = await this.findById(id);
    if (user) {
      user.resetToken = token as any;
      user.resetTokenExpires = expires as any;
      await this.usersRepository.save(user);
    }
  }

  async create(dto: CreateUserDto): Promise<User> {
    if (dto.role === ('SUPER_ADMIN' as any)) {
      const existingSuperAdmin = await this.usersRepository.findOne({
        where: { role: 'SUPER_ADMIN' as any },
      });
      if (existingSuperAdmin) {
        throw new ConflictException(
          'Tidak dapat membuat Super Admin baru. Hanya ada 1 Super Admin di sistem.',
        );
      }
    }
    const existing = await this.findByUsername(dto.username);
    if (existing) {
      throw new ConflictException('Username sudah digunakan');
    }
    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const user = this.usersRepository.create({
      ...dto,
      password: hashedPassword,
    });
    const saved = await this.usersRepository.save(user);
    const { password, ...result } = saved;
    return result as User;
  }

  async update(id: string, dto: UpdateUserDto): Promise<User> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('User tidak ditemukan');
    }
    if (dto.password) {
      dto.password = await bcrypt.hash(dto.password, 10);
    }
    Object.assign(user, dto);
    const saved = await this.usersRepository.save(user);
    const { password, ...result } = saved;
    return result as User;
  }

  async remove(id: string): Promise<void> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('User tidak ditemukan');
    }
    if (user.role === ('SUPER_ADMIN' as any)) {
      throw new ConflictException('Super Admin tidak dapat dinonaktifkan.');
    }
    user.isActive = false;
    await this.usersRepository.save(user);
  }

  async enable(id: string): Promise<void> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('User tidak ditemukan');
    user.isActive = true;
    await this.usersRepository.save(user);
  }

  async hardRemove(id: string): Promise<void> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('User tidak ditemukan');
    if (user.role === ('SUPER_ADMIN' as any)) {
      throw new ConflictException('Super Admin tidak dapat dihapus.');
    }
    try {
      await this.usersRepository.remove(user);
    } catch (error) {
      throw new ConflictException(
        'User tidak dapat dihapus karena masih terkait dengan data lain (misal: riwayat scan/voucher).',
      );
    }
  }

  async count(): Promise<number> {
    return this.usersRepository.count({ where: { isActive: true } });
  }
}
