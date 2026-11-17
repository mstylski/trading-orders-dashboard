import { IsIn, IsNumber, IsPositive, IsString, Matches } from 'class-validator';

export class CreateOrderDto {
  @IsString()
  @Matches(/\S/, { message: 'symbol must contain non-whitespace characters' })
  symbol!: string;

  @IsIn(['BUY', 'SELL'])
  side!: 'BUY' | 'SELL';

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  size!: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  openPrice!: number;
}
