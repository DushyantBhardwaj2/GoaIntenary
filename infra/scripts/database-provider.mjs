import { RDSClient, DescribeDBClustersCommand, CreateDBClusterCommand } from '@aws-sdk/client-rds';

export async function handler(event) {
  let status = 'SUCCESS', reason = 'Goa development database retained', data = {};
  const id = event.ResourceProperties.ClusterId;
  try {
    if (id !== 'goa-dev-postgres') throw new Error('InvalidProjectCluster');
    if (event.RequestType !== 'Delete') {
      const client = new RDSClient({ maxAttempts: 2 });
      let cluster;
      try { cluster = (await client.send(new DescribeDBClustersCommand({ DBClusterIdentifier: id }))).DBClusters[0]; }
      catch (error) { if (!error.name.includes('DBClusterNotFound')) throw error; }
      if (!cluster) cluster = (await client.send(new CreateDBClusterCommand({
        DBClusterIdentifier: id, Engine: 'aurora-postgresql', WithExpressConfiguration: true,
        ServerlessV2ScalingConfiguration: { MinCapacity: 0, MaxCapacity: 1, SecondsUntilAutoPause: 300 },
        BackupRetentionPeriod: 1, CopyTagsToSnapshot: true, DeletionProtection: true,
        Tags: [{ Key: 'Project', Value: 'goa' }, { Key: 'Environment', Value: 'dev' }],
      }))).DBCluster;
      data = { Endpoint: cluster.Endpoint || '', ResourceId: cluster.DbClusterResourceId || '', EngineVersion: cluster.EngineVersion || '' };
    }
  } catch (error) {
    status = 'FAILED';
    // The request contains only project configuration, never passwords/tokens.
    reason = `${error.name}: ${error.message}`.replace(/\d{12}/g, '<account>').slice(0, 600);
    console.error(JSON.stringify({ code: error.name, message: reason }));
  }
  const body = JSON.stringify({ Status: status, Reason: reason, PhysicalResourceId: id, StackId: event.StackId,
    RequestId: event.RequestId, LogicalResourceId: event.LogicalResourceId, Data: data });
  const response = await fetch(event.ResponseURL, { method: 'PUT', headers: { 'content-type': '', 'content-length': String(Buffer.byteLength(body)) }, body });
  if (!response.ok) throw new Error('CloudFormationResponseFailed');
}
