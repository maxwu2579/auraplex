// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
// Short page texts in Chinese with their English versions; other languages use English.
export const en: Record<string, string> = {
  名片模板: 'Business card template',
  '需要名片编辑权限才能修改模板。': 'Editing the template requires business card edit access.',
  '暂时无法读取名片模板，请刷新后再试。': 'The business card template is unavailable. Reload and try again.',
  '有改动还没保存': 'Unsaved changes',
  保存: 'Save',
  放弃: 'Discard',
  显示名字: 'Display name',
  类型: 'Type',
  文字: 'Text',
  日期: 'Date',
  下拉选项: 'Dropdown',
  隐藏: 'Hide',
  上移: 'Move up',
  下移: 'Move down',
  删除: 'Delete',
  '选项（每行一个）': 'Options (one per line)',
  新加格子: 'Add field',
  恢复已删除的格子: 'Restore deleted fields',
  恢复: 'Restore',
  '模板已被其他人修改，请放弃本次改动后重试。': 'Someone else changed the template. Discard your changes and try again.',
  '请填写新格子的名字，并为下拉格子填写有效选项。': 'Name each new field and enter valid dropdown options.',
  未填写: 'Not filled in',
  '删除失败，请检查权限后重试。': 'Could not delete. Check your permissions and try again.',
  '没有符合条件的记录。': 'No matching records.',
  '还没有名片。点右上角"手动新增"拍照或上传名片正面，可以一次选多张。': 'No business cards yet. Use "Add manually" or upload card fronts at the top right; you can pick several at once.',
  '正在检查识别服务…': 'Checking the recognition service…',
  识别服务连不上: 'Cannot reach the recognition service',
  识别服务未配置: 'Recognition service not set up',
  无法处理图片: 'Cannot process the picture',
  图片压缩失败: 'Could not compress the picture',
  图片读取失败: 'Could not read the picture',
  '查重暂不可用，保存时会再检查。': 'Duplicate check unavailable; it will run again when saving.',
  '邮箱已存在，请查看已有记录。': 'This email already exists; please check the existing record.',
  '请上传名片正面。': 'Please upload the front of the card.',
  '资料发生变化，请重新打开后再试。': 'The record changed; please reopen it and try again.',
  '保存失败，请检查网络后重试。': 'Could not save. Check the network and try again.',
  名片核对: 'Check business card',
  新增潜在客户: 'New prospect',
  客户资料: 'Customer details',
  待核对的正面: 'Front to check',
  待核对的背面: 'Back to check',
  查看正面: 'View front',
  选择照片: 'Choose photo',
  更换照片: 'Change photo',
  已有照片: 'Photo saved',
  还没选: 'Not chosen yet',
  '要先在 设置 → 集成 → 名片 AI 填好服务地址，才能自动识别。': 'Set up the card AI in Settings → Integrations first to read cards automatically.',
  '批量上传后自动识别并存入（不用一张张核对，只用正面）': 'After batch upload, read and save cards automatically (no one-by-one check, front only)',
  '名片 AI 还没接，暂时不能用': 'Card AI is not set up yet',
  正在自动存入: 'Saving automatically',
  查看背面: 'View back',
  保存后确认: 'Confirm after saving',
  是: 'Yes',
  否: 'No',
  '处理中…': 'Working…',
  确认保存: 'Confirm and save',
  名片大图: 'Business card',
  '正在检查邮件服务…': 'Checking the mail service…',
  邮件未配置: 'Mail not set up',
  邮件服务连不上: 'Cannot reach the mail service',
  负责人保存失败: 'Could not save the owner',
  '已发出。': 'Sent.',
  发送失败: 'Sending failed',
  '已转给负责人。': 'Forwarded to the owner.',
  转发失败: 'Forwarding failed',
  '记录已经变化，请刷新后再看。': 'The record changed; please refresh.',
  保存失败: 'Could not save',
  客户回复: 'Customer reply',
  转给负责人: 'Forward to owner',
  发出: 'Sent',
  正在发送: 'Sending',
  已发出: 'Sent',
  没发出: 'Not sent',
  结果不确定: 'Result unknown',
  已收到: 'Received',
  负责人: 'Owner',
  正常: 'OK',
  失败: 'Failed',
  不要再发: 'Do not email',
  邮件退回: 'Bounced',
  已发送: 'Sent',
  请先选择负责人: 'Please choose an owner first'
}

export const pick = (lang: string, zh: string): string => (lang === 'zh' || lang === '' ? zh : en[zh] ?? zh)

/** The app language as saved by the theme; tests and early code have none and keep Chinese. */
function savedLanguage (): string {
  try {
    return globalThis.localStorage?.getItem('lang') ?? ''
  } catch {
    return ''
  }
}

/** In plain code (messages). */
export function tt (zh: string): string {
  return pick(savedLanguage(), zh)
}
