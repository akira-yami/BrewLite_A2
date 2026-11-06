import { IsInt, IsNotEmpty, IsString, Max, MaxLength, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class ValidateCouponDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(50)
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    code!: string;

    @IsInt()
    @Min(0)
    @Max(Number.MAX_SAFE_INTEGER)
    subtotal!: number;
}