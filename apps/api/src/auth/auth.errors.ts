import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@devtrack/types';
import { AppException } from '../common/errors/app.exception';

export const invalidCredentials = () =>
  new AppException(
    HttpStatus.UNAUTHORIZED,
    ErrorCode.INVALID_CREDENTIALS,
    'Invalid email or password.',
  );

export const invalidToken = () =>
  new AppException(
    HttpStatus.BAD_REQUEST,
    ErrorCode.INVALID_TOKEN,
    'This link is invalid or has expired. Please request a new one.',
  );

export const emailTaken = () =>
  new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.EMAIL_TAKEN,
    'An account with this email already exists.',
  );

export const usernameTaken = () =>
  new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.USERNAME_TAKEN,
    'This username is already taken.',
  );

export const emailNotVerified = () =>
  new AppException(
    HttpStatus.FORBIDDEN,
    ErrorCode.EMAIL_NOT_VERIFIED,
    'Verify your email address to continue.',
  );
