import { CfnOutput, Names, Size, Stack } from 'aws-cdk-lib';
import { ITableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { DockerImageAsset, Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { Construct } from 'constructs';
import { readFileSync } from 'fs';
import { join } from 'path';
import { EventBus } from './event-bus';
import { Effect, IGrantable, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { CfnRuntime } from 'aws-cdk-lib/aws-bedrockagentcore';

export interface AgentProps {
  table: ITableV2;
  eventBus: EventBus;
  bedrockRegion: string;
}

export class Agent extends Construct {
  public runtimeArn: string;
  constructor(scope: Construct, id: string, props: AgentProps) {
    super(scope, id);

    const { table, eventBus, bedrockRegion } = props;

    const image = new DockerImageAsset(this, 'Image', {
      directory: join('..', 'app'),
      platform: Platform.LINUX_ARM64,
      file: 'agent.Dockerfile',
      exclude: readFileSync(join('..', 'app', '.dockerignore'))
        .toString()
        .split('\n'),
    });
    const role = new Role(this, 'Role', {
      assumedBy: new ServicePrincipal('bedrock-agentcore.amazonaws.com'),
    });
    image.repository.grantPull(role);

    const region = Stack.of(this).region;
    const accountId = Stack.of(this).account;
    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['logs:DescribeLogStreams', 'logs:CreateLogGroup'],
        resources: [`arn:aws:logs:${region}:${accountId}:log-group:/aws/bedrock-agentcore/runtimes/*`],
      })
    );

    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['logs:DescribeLogGroups'],
        resources: [`arn:aws:logs:${region}:${accountId}:log-group:*`],
      })
    );

    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [`arn:aws:logs:${region}:${accountId}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*`],
      })
    );

    role.addToPolicy(
      new PolicyStatement({
        sid: 'ECRTokenAccess',
        effect: Effect.ALLOW,
        actions: ['ecr:GetAuthorizationToken'],
        resources: ['*'],
      })
    );

    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'xray:PutTraceSegments',
          'xray:PutTelemetryRecords',
          'xray:GetSamplingRules',
          'xray:GetSamplingTargets',
        ],
        resources: ['*'],
      })
    );

    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
        conditions: {
          StringEquals: {
            'cloudwatch:namespace': 'bedrock-agentcore',
          },
        },
      })
    );

    role.addToPolicy(
      new PolicyStatement({
        sid: 'GetAgentAccessToken',
        effect: Effect.ALLOW,
        actions: [
          'bedrock-agentcore:GetWorkloadAccessToken',
          'bedrock-agentcore:GetWorkloadAccessTokenForJWT',
          'bedrock-agentcore:GetWorkloadAccessTokenForUserId',
        ],
        resources: [
          `arn:aws:bedrock-agentcore:${region}:${accountId}:workload-identity-directory/default`,
          `arn:aws:bedrock-agentcore:${region}:${accountId}:workload-identity-directory/default/workload-identity/agentName-*`,
        ],
      })
    );

    role.addToPolicy(
      new PolicyStatement({
        sid: 'BedrockModelInvocation',
        effect: Effect.ALLOW,
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: ['arn:aws:bedrock:*::foundation-model/*', `arn:aws:bedrock:${region}:${accountId}:*`],
      })
    );

    const runtime = new CfnRuntime(this, 'Runtime', {
      agentRuntimeName: Names.uniqueResourceName(this, { maxLength: 40 }),
      agentRuntimeArtifact: {
        containerConfiguration: {
          containerUri: image.imageUri,
        },
      },
      networkConfiguration: {
        networkMode: 'PUBLIC',
      },
      roleArn: role.roleArn,
      protocolConfiguration: 'HTTP',
      environmentVariables: {
        TABLE_NAME: table.tableName,
        EVENT_API_ENDPOINT: eventBus.httpEndpoint,
        EVENT_BUS_NAMESPACE: eventBus.defaultChannelName,
        BEDROCK_REGION: bedrockRegion,
      },
    });
    this.runtimeArn = runtime.attrAgentRuntimeArn;
    runtime.node.addDependency(role);

    table.grantReadWriteData(role);
    eventBus.api.grantConnect(role);
    eventBus.api.grantPublishAndSubscribe(role);

    new CfnOutput(this, 'AgentCoreRuntimeArn', { value: this.runtimeArn });
  }

  public grantInvoke(grantee: IGrantable) {
    grantee.grantPrincipal.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ['bedrock-agentcore:InvokeAgentRuntime'],
        resources: [this.runtimeArn, `${this.runtimeArn}/runtime-endpoint/DEFAULT`],
      })
    );
  }
}
