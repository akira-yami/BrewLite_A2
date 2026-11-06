import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  @Length(3, 50)
  @Matches(/^[a-zA-Z0-9_.-]+$/, {
    message: 'Username chỉ được chứa chữ cái, số, dấu gạch dưới, gạch ngang và chấm.',
  })
  username!: string;

  @IsString()
  @IsNotEmpty()
  @Length(6, 100)
  password!: string;
}
