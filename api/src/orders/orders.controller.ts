import { Controller, Get, Query } from '@nestjs/common';
import { OrdersService } from './orders.service';

@Controller()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get('orders')
  getOrders(@Query('status') status?: string) {
    return this.orders.list(status);
  }
}
