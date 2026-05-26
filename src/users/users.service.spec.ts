import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from './user.entity';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt');

describe('UsersService', () => {
  let service: UsersService;

  const mockUsersRepository = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    remove: jest.fn(),
    count: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(User),
          useValue: mockUsersRepository,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should find user by username', async () => {
    mockUsersRepository.findOne.mockResolvedValue({
      id: '1',
      username: 'testuser',
    });
    const user = await service.findByUsername('testuser');
    expect(user).toEqual({ id: '1', username: 'testuser' });
    expect(mockUsersRepository.findOne).toHaveBeenCalledWith({
      where: { username: 'testuser' },
    });
  });

  it('should hash password and strip it from result when creating', async () => {
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashedpassword');
    mockUsersRepository.findOne.mockResolvedValue(null);
    mockUsersRepository.create.mockReturnValue({
      username: 'test',
      fullName: 'john doe',
      password: 'hashedpassword',
    });
    mockUsersRepository.save.mockResolvedValue({
      id: '1',
      username: 'test',
      fullName: 'john doe',
      password: 'hashedpassword',
    });

    const result = await service.create({
      username: 'test',
      fullName: 'john doe',
      password: '123',
    } as any);

    expect(mockUsersRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        fullName: 'john doe',
        password: 'hashedpassword',
      }),
    );
    expect(result.password).toBeUndefined();
  });
});
