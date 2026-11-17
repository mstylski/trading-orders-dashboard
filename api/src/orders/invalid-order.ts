import { InternalServerErrorException } from '@nestjs/common';

export function invalidOrder(): never {
  throw new InternalServerErrorException({ statusCode: 500, message: 'Internal server error' });
}
