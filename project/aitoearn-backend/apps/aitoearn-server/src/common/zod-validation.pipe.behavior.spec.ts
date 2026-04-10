import { ZodValidationPipe } from '@yikart/common'
import { IsString } from 'class-validator'
import { describe, expect, it } from 'vitest'

class SendSmsDto {
  @IsString()
  phone!: string
}

describe('zodValidationPipe behavior', () => {
  it('preserves class-validator dto fields during transform', async () => {
    const pipe = new ZodValidationPipe()

    const result = await pipe.transform(
      { phone: '13800138000' },
      {
        type: 'body',
        metatype: SendSmsDto,
        data: '',
      },
    ) as SendSmsDto

    expect(result).toBeInstanceOf(SendSmsDto)
    expect(result.phone).toBe('13800138000')
  })
})
