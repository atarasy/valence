import {PRODUCTION_DEPLOYMENT_ID} from '../identity.ts';
import {memberEntry} from '../serve.ts';
import type {MemberRuntimeConfig} from '../../config.ts';
import config from './config.json';
import aasa from './aasa.json';
export default memberEntry(PRODUCTION_DEPLOYMENT_ID,config as MemberRuntimeConfig,aasa);
