import fetch from 'node-fetch'
import { RbDataProvider } from 'rb-core-module'

const retryCodes = [408, 500, 502, 503, 504, 522, 524]

function _renderQuerystring (filters, sort, order, offset, limit) {
  const params = []
  if (filters) {
    for (const key in filters) {
      const filterValue = filters[key]
      let values = [filterValue]
      if (Array.isArray(filterValue)) {
        values = filterValue
      } else if (
        filterValue !== null &&
        typeof filterValue === 'object'
      ) {
        values = Object.keys(filterValue).filter(val => !!filterValue[val])
      }
      values.forEach(val => params.push(`${key}=${val}`))
    }
  }
  if (sort) {
    const _sort = Array.isArray(sort) ? sort.join(',') : sort
    params.push(`_sort=${_sort}`)
  }
  if (order) {
    params.push(`_order=${order}`)
  }
  if (offset) {
    params.push(`_start=${offset}`)
  }
  if (limit) {
    params.push(`_limit=${limit}`)
  }
  return params.join('&')
}

async function _defaultClient (url, options) {
  const opts = { ...options }
  const contentType = opts.headers && opts.headers['Content-Type']
  const shouldBodyBeString = (
    !contentType ||
    contentType.startsWith('application/json') ||
    contentType.startsWith('text/')
  )
  const isBodyString = typeof opts.body === 'string'
  if (shouldBodyBeString && !isBodyString && opts.body) {
    opts.body = JSON.stringify(opts.body)
  }
  return fetch(url, opts)
}

class RbDataProviderJsonServer extends RbDataProvider {
  constructor (apiURL, {
    timeout,
    retries,
    backoff,
    client,
    tokenGetter,
    responseParser,
    querystringRenderer
  } = {}) {
    super()
    this.apiURL = apiURL
    this.timeout = timeout || 5000
    this.retries = retries || 3
    this.backoff = backoff || 300
    this.getToken = tokenGetter || (() => undefined)
    this.parseResponse = responseParser || (res => res.data || res)
    this.renderQuerystring = querystringRenderer || _renderQuerystring
    this.client = client || _defaultClient
  }

  async getMany (resource, {
    filters = {},
    sort = '',
    order = '',
    offset = 0,
    limit = null
  } = {}) {
    const base = `${this.apiURL}/${resource}`
    const qs = this.renderQuerystring(filters, sort, order, offset, limit)
    const url = [base, qs].filter((v) => v).join('?')
    const res = await this._performRequest(url, {
      method: 'GET'
    }, this.retries)
    return {
      data: this.parseResponse(res)
    }
  }

  async getOne (resource, { id }) {
    const url = `${this.apiURL}/${resource}/${id}`
    const res = await this._performRequest(url, {
      method: 'GET'
    }, this.retries)
    return {
      data: this.parseResponse(res)
    }
  }

  async createOne (resource, data) {
    const { id, ...attrs } = data
    const url = `${this.apiURL}/${resource}`
    const res = await this._performRequest(url, {
      method: 'POST',
      body: attrs
    }, this.retries)
    return {
      data: this.parseResponse(res)
    }
  }

  async updateOne (resource, { id, ...data }) {
    const url = `${this.apiURL}/${resource}/${id}`
    const res = await this._performRequest(url, {
      method: 'PATCH',
      body: data
    }, this.retries)
    return {
      data: this.parseResponse(res)
    }
  }

  async updateMany (resource, data) {
    const url = `${this.apiURL}/${resource}`
    const res = await this._performRequest(url, {
      method: 'PATCH',
      body: data
    }, this.retries)
    return {
      data: this.parseResponse(res)
    }
  }

  async deleteOne (resource, { id }) {
    const url = `${this.apiURL}/${resource}/${id}`
    await this._performRequest(url, {
      method: 'DELETE'
    }, this.retries)
    return {
      data: { id }
    }
  }

  async _performRequest (url, options, retries, backoff) {
    const _backoff = backoff || this.backoff
    const _token = await this.getToken()
    const _headers = {
      'Content-Type': 'application/json; charset=UTF-8',
      Authorization: _token && `Bearer ${_token}`,
      ...options.headers
    }
    const res = await this.client(url, {
      timeout: this.timeout,
      ...options,
      headers: _headers
    })
    if (!res.ok) {
      if (retries > 1 && retryCodes.includes(res.status)) {
        return new Promise((resolve, reject) => {
          setTimeout(async () => {
            try {
              const res = await this._performRequest(url, options, retries - 1, _backoff * 2)
              resolve(res)
            } catch (err) {
              reject(err)
            }
          }, _backoff)
        })
      } else {
        throw new Error(res.statusText)
      }
    }
    return res.json()
  }
}

function createProvider (apiURL, opts) {
  return new RbDataProviderJsonServer(apiURL, opts)
}

export default createProvider
