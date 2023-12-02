import * as http from 'node:http';


// const gAwsCreds = {
//   access_key_id:      process.env.AWS_ACCESS_KEY_ID,
//   secret_access_key:  process.env.AWS_SECRET_ACCESS_KEY,
//   session_token:      process.env.AWS_SESSION_TOKEN,
// };


// export const handler = async (event, context) => {
//   let token = await get_zoho_auth_token('development');

//   console.log('TOKEN!');
//   console.log(token);
// };

// async function get_zoho_auth_token(deploy_env){
export const get_zoho_auth_token = async(deploy_env) => {
  
  if (!deploy_env){
    console.error('Deployment Environment cannot be null!');
    return null;
  }
    
  // /secrets/development/zoho/access_token
  let paramPath = 'zoho/access_token';
  let paramInfo = await ensure_get_fresh_parameter(deploy_env, '/secrets', paramPath, process.env.ZOHO_TOKEN_STALE_AFTER);
  
  if (!paramInfo || paramInfo.errors)
    return null;

  return paramInfo.value;
}

async function ensure_get_fresh_parameter(deploy_env, paramType, paramPath, staleAfterInSecs = null){

  let fullParamPath = [paramType, deploy_env, paramPath].join('/');
  let paramVersion = process.env.INITIAL_TOKEN_VERSION;

  let retry_no = 0;

  let outParams = {
    errors: null,
    value: null,
    paramMeta: {}
  };

  while(retry_no <= process.env.MAX_RETRIES_FOR_FRESH_TOKEN){

    retry_no += 1;

    let paramInfo = await get_parameter_from_store(fullParamPath, paramVersion);

    console.log(JSON.stringify(paramInfo));

    // Expected Output
    //
    // {
    //   "Parameter": {
    //     "ARN": "arn:aws:ssm:eu-west-2:620482149103:parameter/secrets/development/zoho/access_token",
    //     "DataType": "text",
    //     "LastModifiedDate": "2023-11-29T18:40:39.777Z",
    //     "Name": "/secrets/development/zoho/access_token",
    //     "Selector": null,
    //     "SourceResult": null,
    //     "Type": "String",
    //     "Value": "1000.4c720763842ae2df76858e3ed387dac5",
    //     "Version": 2
    //   },
    //   "ResultMetadata": {}
    // }

    outParams.paramMeta = paramInfo;

    if (!paramInfo || paramInfo.errors){

      console.error(['ParameterStore', fullParamPath, 
                  'Error while fetching',
                  'output:',
                  JSON.stringify(paramInfo)].join(' | '));

      outParams.errors = paramInfo?.errors;
      return outParams;
    }

    outParams.value = paramInfo.Parameter.Value;

    if (staleAfterInSecs === null)
      return outParams;

    // Check if parameter is already stale
    if(is_param_stale(paramInfo.Parameter.LastModifiedDate, staleAfterInSecs)){

      console.error(['ParameterStore', fullParamPath, 
                  `v${paramVersion || paramInfo.Parameter.Version}`,
                  'is stale.'].join(' | '));

      paramVersion = paramInfo.Parameter.Version + 1;
      continue; // fetch the next version
    }

    return outParams;
  } // End while

  // If the code reaches here, it has failed all the retries
  console.error("ALL RETRIES FAILED!");
}

function is_param_stale(timestamp, staleAfterInSecs){
  return (Date.now() - (new Date(timestamp))) > staleAfterInSecs * 1000;
}

async function get_parameter_from_store(fullParamPath, paramVersion = process.env.INITIAL_TOKEN_VERSION){
  
  let url_path = `/systemsmanager/parameters/get/?name=${fullParamPath}`;
  // let url_path = `/systemsmanager/parameters/get/?name=/secrets/development/zoho/access_token`;
  
  
  if (paramVersion !== process.env.INITIAL_TOKEN_VERSION)
    url_path += `&version=${paramVersion}`;

  let opts = {
    host: 'localhost',
    port: 2773,
    path: url_path,
    method: 'GET',
    headers: {
      'X-Aws-Parameters-Secrets-Token': process.env.AWS_SESSION_TOKEN
    }
  };
  
  console.log(`FETCHING ${url_path}`);

  let response;

  try {
    response = await make_http_call(opts);
  } catch (e) {
    return {message: `Error while fetching parameter from store`,  errors: e};
  }
  
  try {
    response = JSON.parse(response);
  } catch (e) {
    return {message: `Malformed JSON from returned from server`,  errors: e};
  }
  
  return response;
}

// NO JSON.parse happening inside - as I was unable to handle the 
// case when the JSON was malformed
const make_http_call = (options) => new Promise((resolve, reject) => {
  let payload = options.req_body || '';
  const req = http.request(options, res => {
    let buffer = "";
    res.on('data', chunk => buffer += chunk);
    res.on('end', () => resolve(buffer));
  });
  req.on('error', e => reject(e.message));
  req.write(JSON.stringify(payload));
  req.end();
});

// export default get_zoho_auth_token