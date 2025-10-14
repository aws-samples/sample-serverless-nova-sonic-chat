import { CfnOutput, CfnResource, Duration, Stack } from 'aws-cdk-lib';
import { DomainName, HttpApi, HttpStage, LogGroupLogDestination } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';
import { ITableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { Architecture, DockerImageFunction, IFunction } from 'aws-cdk-lib/aws-lambda';
import { ARecord, IHostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { ApiGatewayv2DomainProperties } from 'aws-cdk-lib/aws-route53-targets';
import { Construct } from 'constructs';
import { join } from 'path';
import { Auth } from './auth';
import { readFileSync } from 'fs';
import { ContainerImageBuild } from 'deploy-time-build';
import { EventBus } from './event-bus';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { Agent } from './agent';

export interface ServiceProps {
  table: ITableV2;
  auth: Auth;
  hostedZone?: IHostedZone;
  subDomain?: string;
  eventBus: EventBus;
  agent: Agent;
}

export class Service extends Construct {
  public readonly endpoint: string;

  constructor(scope: Construct, id: string, props: ServiceProps) {
    super(scope, id);
    const { table, subDomain = 'api', auth, eventBus, agent } = props;

    // Use ContainerImageBuild to inject deploy-time values in the build environment
    const image = new ContainerImageBuild(this, 'Build', {
      directory: join('..', 'app'),
      platform: Platform.LINUX_AMD64,
      exclude: [
        ...readFileSync(join('..', 'app', '.dockerignore'))
          .toString()
          .split('\n'),
        'src/agent',
      ],
      tagPrefix: 'agent-',
      buildArgs: {
        SKIP_TS_BUILD: 'true',
        NEXT_PUBLIC_AWS_REGION: Stack.of(this).region,
        NEXT_PUBLIC_EVENT_API_ENDPOINT: eventBus.httpEndpoint,
        NEXT_PUBLIC_EVENT_BUS_NAMESPACE: eventBus.defaultChannelName,
      },
    });

    {
      const project = Stack.of(this).node.findChild('ContainerImageBuildAmd64e83729feb1564e709bec452b15847a30amd64')
        .node.defaultChild as CfnResource;
      // project.addPropertyOverride('Environment.DockerServer', { ComputeType: 'BUILD_GENERAL1_SMALL' });
    }

    const handler = new DockerImageFunction(this, 'Handler', {
      code: image.toLambdaDockerImageCode(),
      environment: {
        COGNITO_DOMAIN: auth.domainName,
        USER_POOL_ID: auth.userPool.userPoolId,
        USER_POOL_CLIENT_ID: auth.client.userPoolClientId,
        TABLE_NAME: table.tableName,
        // AMPLIFY_APP_ORIGIN: '', // will be populated below
        AGENT_CORE_RUNTIME_ARN: props.agent.runtimeArn,
      },
      timeout: Duration.seconds(29),
      memorySize: 1769,
      architecture: Architecture.X86_64,
    });
    table.grantReadWriteData(handler);
    props.agent.grantInvoke(handler);

    let domainName: DomainName | undefined;
    let fullDomainName: string | undefined;

    // Create API with custom domain if hostedZone is provided
    if (props.hostedZone) {
      // Construct the full domain name using the hosted zone
      fullDomainName = `${subDomain}.${props.hostedZone.zoneName}`;

      // Create a certificate for the domain
      const certificate = new Certificate(this, 'Certificate', {
        domainName: fullDomainName,
        validation: CertificateValidation.fromDns(props.hostedZone),
      });

      // Create a custom domain name for API Gateway
      domainName = new DomainName(this, 'DomainName', {
        domainName: fullDomainName,
        certificate,
      });
    }

    // Create the HTTP API
    const api = new HttpApi(this, 'Resource', {
      description: 'nova sonic demo webapp',
      defaultDomainMapping: domainName
        ? {
            domainName: domainName,
          }
        : undefined,
      createDefaultStage: false,
    });
    this.endpoint = api.apiEndpoint;

    const logGroup = new LogGroup(this, 'AccessLog', {});
    new HttpStage(api, 'DefaultStage', {
      httpApi: api,
      autoDeploy: true,
      accessLogSettings: {
        destination: new LogGroupLogDestination(logGroup),
      },
    });

    const integration = new HttpLambdaIntegration('Integration', handler, {});
    api.addRoutes({
      path: '/{proxy+}',
      integration,
    });

    // Create Route53 record if custom domain is configured
    if (props.hostedZone) {
      new ARecord(this, 'DnsRecord', {
        zone: props.hostedZone,
        recordName: subDomain,
        target: RecordTarget.fromAlias(
          new ApiGatewayv2DomainProperties(domainName!.regionalDomainName, domainName!.regionalHostedZoneId)
        ),
      });
      this.endpoint = `https://${fullDomainName}`;
    }
    handler.addEnvironment('AMPLIFY_APP_ORIGIN', this.endpoint);

    auth.addAllowedCallbackUrls(
      `http://localhost:3005/api/auth/sign-in-callback`,
      `http://localhost:3005/api/auth/sign-out-callback`
    );
    auth.addAllowedCallbackUrls(
      `${this.endpoint}/api/auth/sign-in-callback`,
      `${this.endpoint}/api/auth/sign-out-callback`
    );

    new CfnOutput(this, 'ApiEndpoint', { value: this.endpoint });
  }
}
