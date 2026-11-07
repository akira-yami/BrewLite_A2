// ==========================================
// COUPON DOMAIN
// ==========================================
export interface ValidateCouponPayload {
    code: string;
    subtotal: number;
}

export interface ValidateCouponResponse {
    code: string;
    discountAmount: number;
}

// ==========================================
// PAYMENT DOMAIN
// ==========================================
export type PaymentMethod = 'E_WALLET' | 'CARD';

export type PaymentStatus = 'PROCESSING' | 'SUCCEEDED' | 'FAILED';

export interface CreatePaymentPayload {
    orderId: string;
    method: PaymentMethod;
}

/**
 * Response trả về từ POST /api/v1/payments (sau unwrap .data)
 * - id: UUID của Payment attempt
 * - status: kết quả thanh toán theo PaymentStatus
 * - orderId: đơn hàng tương ứng
 * - success/isRetried: legacy fields kept for backward compat (optional)
 */
export interface PaymentResponse {
    id: string;
    status: PaymentStatus;
    orderId: string;
    /** Legacy: có thể không có trong response thực tế */
    success?: boolean;
    isRetried?: boolean;
    gatewayTransactionId?: string | null;
    errorCode?: string | null;
    failureCode?: string | null;
}
