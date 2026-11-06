import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { ConsoleMailer } from './console.mailer';
import { MAILER, type Mailer } from './mailer';
import { ResendMailer } from './resend.mailer';

@Global()
@Module({
  providers: [
    {
      provide: MAILER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Mailer => {
        switch (config.mail.transport) {
          case 'console':
            return new ConsoleMailer();
          case 'resend':
            return new ResendMailer(config.mail.apiKey, config.mail.from);
        }
      },
    },
  ],
  exports: [MAILER],
})
export class MailModule {}
