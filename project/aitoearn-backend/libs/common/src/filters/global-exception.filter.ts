import type { Response } from 'express'
import type { Observable } from 'rxjs'

import type { CommonResponse } from '../interfaces'
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common'
import { of } from 'rxjs'
import { AppException } from '../exceptions'
import {
  API_CONTRACT_METADATA_KEY,
  API_CONTRACT_TYPES,
  buildMediaClawErrorResponse,
} from '../index'
import { getExceptionPayload } from '../utils'

export interface GlobalExceptionFilterOptions {
  returnBadRequestDetails?: boolean
}

@Catch()
export class GlobalExceptionFilter<T> implements ExceptionFilter<T> {
  protected readonly logger = new Logger(GlobalExceptionFilter.name)
  constructor(private options: GlobalExceptionFilterOptions = {}) { }

  catch(exception: T, host: ArgumentsHost): void | Observable<CommonResponse<unknown> | void> {
    if (
      exception instanceof InternalServerErrorException
    ) {
      this.logger.fatal(exception)
    }
    else if (exception instanceof UnauthorizedException || exception instanceof AppException) {
      this.logger.warn(exception)
    }
    else if (exception instanceof HttpException) {
      this.logger.error(exception)
    }
    else {
      this.logger.fatal(exception)
    }

    const payload = getExceptionPayload(exception, this.options.returnBadRequestDetails)

    return this.handleError(host, {
      ...payload,
      timestamp: Date.now(),
    })
  }

  handleError(host: ArgumentsHost, payload: CommonResponse<unknown>) {
    const type = host.getType()

    if (type === 'rpc') {
      return this.handleRpcError(host, payload)
    }
    return this.handleHttpError(host, payload)
  }

  private handleRpcError(
    host: ArgumentsHost,
    payload: CommonResponse<unknown>,
  ) {
    return of(payload)
  }

  private handleHttpError(
    host: ArgumentsHost,
    payload: CommonResponse<unknown>,
  ) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const executionHost = host as ArgumentsHost & {
      getHandler?: () => unknown
      getClass?: () => unknown
    }
    const handler = executionHost.getHandler?.()
    const targetClass = executionHost.getClass?.()
    const contract = handler && (typeof handler === 'object' || typeof handler === 'function')
      ? Reflect.getMetadata(API_CONTRACT_METADATA_KEY, handler)
      || (targetClass && typeof targetClass === 'function'
        ? Reflect.getMetadata(API_CONTRACT_METADATA_KEY, targetClass)
        : undefined)
      : (targetClass && typeof targetClass === 'function'
          ? Reflect.getMetadata(API_CONTRACT_METADATA_KEY, targetClass)
          : undefined)

    response.status(200).json(
      contract === API_CONTRACT_TYPES.MEDIACLAW_V1
        ? buildMediaClawErrorResponse(payload)
        : payload,
    )
  }
}
