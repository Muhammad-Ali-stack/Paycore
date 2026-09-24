import { ApiProperty } from '@nestjs/swagger';

export class HealthDto {
  @ApiProperty({ enum: ['ok'] })
  status!: 'ok';

  @ApiProperty({ enum: ['up'] })
  db!: 'up';

  @ApiProperty({ enum: ['up'] })
  redis!: 'up';
}
