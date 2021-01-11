import * as core from '@actions/core';
import axios from 'axios';
import CryptoJs from 'crypto-js';
import FormData from 'form-data';
import fs from 'fs-extra';

import Notify, { Context, Res } from './notify';

export default class Lark extends Notify {
  signKey: string | undefined;
  signature: string | undefined;
  timestamp: string = new Date().getTime().toString();
  constructor(webhook: string, githubCtx: Context, inputs: any) {
    super(webhook, githubCtx, inputs);
    this.signKey = inputs.signKey;
  }

  async uploadLocalFile(): Promise<string> {
    const { LARK_APP_ID = '', LARK_APP_SECRECT = '', LARK_PREVIEW_PIC_DIR = '' } = process.env;

    if (!(LARK_PREVIEW_PIC_DIR && LARK_APP_ID && LARK_APP_SECRECT)) {
      core.setFailed(
        `Action failed with error missing onf of [LARK_PREVIEW_PIC_DIR, LARK_APP_ID, LARK_APP_SECRECT]`,
      );

      return '';
    }
    const tenant_access_token = await this.getAccessToken(LARK_APP_ID, LARK_APP_SECRECT);

    if (!tenant_access_token) return '';

    const form_data = new FormData();
    form_data.append('image', fs.createReadStream(LARK_PREVIEW_PIC_DIR));
    form_data.append('image_type', 'message');

    const headers = {
      ...form_data.getHeaders(),
    };

    const request_config: any = {
      url: 'https://open.feishu.cn/open-apis/image/v4/put/',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tenant_access_token}`,
        ...headers,
      },
      data: form_data,
    };

    const uploadRes = await axios.request(request_config);

    if (uploadRes.status === 200 && uploadRes.data && uploadRes.data.code === 0) {
      return uploadRes.data.data.image_key;
    }

    console.log(uploadRes);
    core.setFailed(`upload faild`);

    return '';
  }

  async getAccessToken(LARK_APP_ID: string, LARK_APP_SECRECT: string): Promise<string> {
    const res = await axios.request({
      url: 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal/',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      data: {
        app_id: LARK_APP_ID,
        app_secret: LARK_APP_SECRECT,
      },
    });

    let tenant_access_token = '';

    if (res.status === 200 && res.data && res.data.code === 0) {
      tenant_access_token = res.data.tenant_access_token;
    }

    if (!tenant_access_token) {
      core.setFailed('get tenant_access_token error, please check');
      return '';
    }

    console.log(res, tenant_access_token);

    return tenant_access_token;
  }

  async notify(): Promise<Res> {
    const enableImage = core.getInput('enable_image');

    let image_key = '';
    if (enableImage) {
      image_key = await this.uploadLocalFile();
    }

    this.timestamp = new Date().getTime().toString();
    if (this.signKey) {
      this.signature = this.genSin(this.signKey, this.timestamp);
    }

    const { ctxFormatContent, signature: sign, inputs } = this;

    const requestPayload = {
      timestamp: this.timestamp,
      sign,
      msg_type: 'interactive',
      card: {
        config: {
          wide_screen_mode: true,
          enable_forward: true,
        },
        header: {
          title: {
            content: `${inputs.notifyTitle}`,
            tag: 'plain_text',
          },
          template: 'red',
        },
        elements: [
          {
            tag: 'div',
            text: {
              content: `**Author** ${ctxFormatContent.actor}`,
              tag: 'lark_md',
            },
          },
          {
            tag: 'div',
            text: {
              content: `**Ref** ${ctxFormatContent.ref}  **Event** ${ctxFormatContent.eventName}`,
              tag: 'lark_md',
            },
          },
          {
            tag: 'div',
            text: {
              content: `**Message**，\n ${inputs.notifyMessage || ctxFormatContent.commitsContent}`,
              tag: 'lark_md',
            },
          },
          {
            tag: 'img',
            title: {
              tag: 'lark_md',
              content: '开发预览二维码',
            },
            mode: 'crop_center',
            img_key: `${image_key}`,
            alt: {
              tag: 'plain_text',
              content: '开发预览二维码',
            },
          },
          {
            actions: [
              {
                tag: 'button',
                text: {
                  content: 'More Information :玫瑰:',
                  tag: 'lark_md',
                },
                url: `${ctxFormatContent.actionUrl}`,
                type: 'default',
                value: {},
              },
            ],
            tag: 'action',
          },
        ],
      },
    };

    const res: any = await axios({
      method: 'post',
      url: this.webhook,
      data: requestPayload,
    });

    return {
      code: res.code || res.data.StatusCode,
      data: res.data,
      msg: res.msg,
    };
  }

  genSin(signKey: string | undefined = this.signKey, timestamp: string): string {
    const crytoStr = `${timestamp}\n${signKey}`;
    const signature = CryptoJs.enc.Base64.stringify(CryptoJs.HmacSHA256('', crytoStr));

    return signature;
  }
}
