import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { DomainError } from '../../common/errors/domain-error';
import { FindUserQuery, LookupQuery, SuspendUserDto, UpdateProfileDto, UserDto, UserLookupDto } from './users.dto';
import { UsersService, userView } from './users.service';

export { FindUserQuery, SuspendUserDto, UpdateProfileDto } from './users.dto';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOkResponse({ type: UserDto })
  async me(@CurrentUser() user: AuthUser): Promise<UserDto> {
    return userView(await this.users.getById(user.id));
  }

  @Patch('me')
  @ApiOkResponse({ type: UserDto })
  async update(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto): Promise<UserDto> {
    return userView(await this.users.updateProfile(user.id, dto));
  }

  /**
   * Find someone to pay by phone or @username. Returns only a masked phone and a short display
   * name. Rate-limited more strictly than other reads to slow down enumeration.
   */
  @Get('lookup')
  @Throttle({ default: { limit: () => Number(process.env.LOOKUP_THROTTLE_LIMIT ?? 30), ttl: 60_000 } })
  @ApiOkResponse({ type: UserLookupDto })
  lookup(@Query() query: LookupQuery): Promise<UserLookupDto> {
    return this.users.lookup(query.q);
  }
}

@ApiTags('admin / users')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOkResponse({ type: UserDto })
  async find(@Query() query: FindUserQuery): Promise<UserDto> {
    const user = await this.users.findByPhone(query.phone);
    if (!user) throw new DomainError('NOT_FOUND', 'User not found');
    return userView(user);
  }

  @Get(':id')
  @ApiOkResponse({ type: UserDto })
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<UserDto> {
    return userView(await this.users.getById(id));
  }

  @Post(':id/suspend')
  @ApiCreatedResponse({ type: UserDto })
  async suspend(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SuspendUserDto, @CurrentUser() admin: AuthUser): Promise<UserDto> {
    return userView(await this.users.suspend(id, admin.id, dto.reason));
  }

  @Post(':id/reactivate')
  @ApiCreatedResponse({ type: UserDto })
  async reactivate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: AuthUser): Promise<UserDto> {
    return userView(await this.users.reactivate(id, admin.id));
  }
}
