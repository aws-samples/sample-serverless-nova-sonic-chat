import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EventBus } from './constructs/event-bus';
import { Database } from './constructs/database';
import { Agent } from './constructs/agent';
import { Auth } from './constructs/auth';
import { Service } from './constructs/service';

interface CdkStackProps extends cdk.StackProps {
  /**
   * Enable Cognito self signup
   * @default true
   */
  readonly selfSignUpEnabled?: boolean;

  /**
   * @default Allow all domains
   * @example example.com
   */
  readonly allowedEmailDomainList?: string[];

  /**
   * Bedrock region for Nova Sonic model. Please see [this page](https://docs.aws.amazon.com/nova/latest/userguide/what-is-nova.html) for the list of supported regions.
   * @default 'us-east-1'
   */
  readonly bedrockRegion?: string;
}

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CdkStackProps) {
    super(scope, id, { ...props, description: 'Serverless Nova Sonic Chat App (uksb-r1iyuqfyvk)' });

    const database = new Database(this, 'Database', {});
    const auth = new Auth(this, 'Auth', {
      selfSignUpEnabled: props.selfSignUpEnabled ?? true,
      allowedEmailDomainList: props.allowedEmailDomainList,
    });
    const eventBus = new EventBus(this, 'EventBus', { userPool: auth.userPool });

    const agent = new Agent(this, 'Agent', {
      table: database.table,
      eventBus,
      bedrockRegion: props.bedrockRegion!,
    });

    const service = new Service(this, 'Service', {
      table: database.table,
      auth,
      eventBus,
      agent,
    });
  }
}
