import { Body, Controller, Get, Headers, Param, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { CreateOrderDto } from './create-order.dto';
import { OrdersService } from './orders.service';

@Controller()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get('orders')
  getOrders(@Query('status') status?: string) {
    return this.orders.list(status);
  }

  @Get('orders/operations/:key')
  async getCreationResult(
    @Param('key') key: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.orders.findCreation(key);
    response.status(result.statusCode);
    return result.body;
  }

  @Post('orders')
  async createOrder(
    @Body() input: CreateOrderDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.orders.create(input, key);
    response.status(result.statusCode);
    return result.body;
  }
}
