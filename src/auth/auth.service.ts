import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  async validateUser(username: string, password: string) {
    const user = await this.usersService.findByUsername(username);
    if (!user) {
      throw new UnauthorizedException('Username atau password salah');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Akun tidak aktif');
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Username atau password salah');
    }
    return user;
  }

  async login(username: string, password: string) {
    const user = await this.validateUser(username, password);
    const payload = { sub: user.id, username: user.username, role: user.role };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
      },
    };
  }

  async forgotPassword(username: string) {
    const user = await this.usersService.findByUsername(username);
    if (!user || !user.isActive) {
      return {
        message:
          'Jika username terdaftar, instruksi reset password telah dikirim.',
      };
    }
    const token = require('crypto').randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 3600000); // 1 hour
    await this.usersService.updateResetToken(user.id, token, expires);
    console.log(
      `\n\n[RESET PASSWORD LINK]: http://localhost:3000/reset-password.html?token=${token}\n\n`,
    );
    return {
      message:
        'Instruksi reset password telah dibuat. Silakan cek console log (karena belum ada layanan email).',
    };
  }

  async resetPassword(token: string, newPassword: string) {
    const user = await this.usersService.findByResetToken(token);
    if (
      !user ||
      !user.resetTokenExpires ||
      user.resetTokenExpires < new Date()
    ) {
      throw new BadRequestException('Token tidak valid atau sudah kedaluwarsa');
    }
    await this.usersService.update(user.id, { password: newPassword } as any);
    await this.usersService.updateResetToken(user.id, null, null);
    return { message: 'Password berhasil diubah. Silakan login.' };
  }
}
