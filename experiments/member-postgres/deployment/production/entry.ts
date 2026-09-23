import {PRODUCTION_DEPLOYMENT_ID} from '../identity.ts';
import {memberEntry} from '../serve.ts';
import type {MemberRuntimeConfig} from '../../config.ts';
import config from './config.json';
import aasa from './aasa.json';
import privacy from './privacy.html' with {type:'text'};
import support from './support.html' with {type:'text'};
export default memberEntry(PRODUCTION_DEPLOYMENT_ID,config as MemberRuntimeConfig,aasa,{'/privacy':privacy,'/support':support});
