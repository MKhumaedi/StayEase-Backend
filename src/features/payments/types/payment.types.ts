export interface MidtransTransactionDetails {
  order_id: string;
  gross_amount: number;
}

export interface MidtransCustomerDetails {
  first_name: string;
  email: string;
  phone?: string;
}

export interface MidtransItemDetails {
  id: string;
  price: number;
  quantity: number;
  name: string;
}

export interface MidtransSnapRequest {
  transaction_details: MidtransTransactionDetails;
  customer_details?: MidtransCustomerDetails;
  item_details?: MidtransItemDetails[];
  enabled_payments?: string[];
}

export interface MidtransSnapResponse {
  token: string;
  redirect_url: string;
}

export interface MidtransNotificationPayload {
  transaction_status: string;
  order_id: string;
  gross_amount: string;
  payment_type: string;
  signature_key: string;
  status_code: string;
}
