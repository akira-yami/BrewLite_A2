export interface OrderItemResponseDto {
  id: string;
  productName: string;
  size: string;
  unitPrice: number;
  quantity: number;
  sugarLevel: number | null;
  iceLevel: number | null;
  note: string | null;
  toppings: Array<{ name: string; unitPrice: number; quantity: number }>;
  lineTotal: number;
}
