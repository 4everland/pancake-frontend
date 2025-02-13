/* eslint-disable camelcase */
import { AptosCoin, Coin } from '@pancakeswap/aptos-swap-sdk'
import { Pool } from '@pancakeswap/uikit'
import { PoolCategory } from 'config/constants/types'
import BigNumber from 'bignumber.js'
import _toNumber from 'lodash/toNumber'
import _get from 'lodash/get'
import { FixedNumber } from '@ethersproject/bignumber'
import { BIG_ZERO } from '@pancakeswap/utils/bigNumber'
import uuid from 'uuid'

import _find from 'lodash/find'

import { PoolResource } from '../types'
import getSecondsLeftFromNow from '../utils/getSecondsLeftFromNow'
import splitTypeTag from '../utils/splitTypeTag'
import getTokenByAddress from '../utils/getTokenByAddress'

const transformPool = (
  resource: PoolResource,
  balances,
  chainId,
  addressesWithUSD,
): Pool.DeserializedPool<Coin | AptosCoin> | undefined => {
  const [stakingAddress, earningAddress] = splitTypeTag(resource.type)

  let userData = {
    allowance: new BigNumber(0),
    pendingReward: new BigNumber(0),
    stakedBalance: new BigNumber(0),
    stakingTokenBalance: new BigNumber(0),
  }

  const totalStakedToken = _get(resource, 'data.total_staked_token.value', '0')

  if (balances?.length) {
    const resourceTypes = resource.type
    const foundStakedPoolBalance = balances.find(
      (balance) => balance.type === resourceTypes.replace('PoolInfo', 'UserInfo'),
    )

    if (foundStakedPoolBalance) {
      const foundStakingBalance = balances.find((balance) => balance.type === `0x1::coin::CoinStore<${stakingAddress}>`)
      const amount = _get(foundStakingBalance, 'data.coin.value')

      if (amount) {
        userData = { ...userData, stakingTokenBalance: new BigNumber(amount) }
      }

      const currentRewardDebt = _get(foundStakedPoolBalance, 'data.reward_debt')

      const userStakedAmount = _get(foundStakedPoolBalance, 'data.amount')

      if (userStakedAmount && _toNumber(totalStakedToken)) {
        const lastRewardTimestamp = _toNumber(_get(resource, 'data.last_reward_timestamp'))

        const multiplier = FixedNumber.from(getSecondsLeftFromNow(lastRewardTimestamp))

        const rewardPerSecond = FixedNumber.from(_get(resource, 'data.reward_per_second'))

        const rewardPendingToken = rewardPerSecond.mulUnsafe(multiplier)

        const tokenPerShare = FixedNumber.from(_get(resource, 'data.acc_token_per_share'))
        const precisionFactor = FixedNumber.from(_get(resource, 'data.precision_factor'))
        const totalStake = FixedNumber.from(totalStakedToken)

        const latestTokenPerShare = tokenPerShare.addUnsafe(
          rewardPendingToken.mulUnsafe(precisionFactor).divUnsafe(totalStake),
        )

        const rewardDebt = FixedNumber.from(currentRewardDebt)

        const pendingReward = FixedNumber.from(userStakedAmount)
          .mulUnsafe(latestTokenPerShare)
          .divUnsafe(precisionFactor)
          .subUnsafe(rewardDebt)

        userData = {
          ...userData,
          pendingReward: new BigNumber(pendingReward.toString()),
          stakedBalance: new BigNumber(userStakedAmount),
        }
      }
    }
  }

  const now = Date.now()

  const stakingToken = getTokenByAddress({ chainId, address: stakingAddress })
  const earningToken = getTokenByAddress({ chainId, address: earningAddress })

  if (!stakingToken || !earningToken) return undefined

  const earningTokenPrice = addressesWithUSD[earningAddress] || 0
  const stakingTokenPrice = addressesWithUSD[stakingAddress] || 0

  return {
    sousId: uuid.v4(),
    contractAddress: {
      [chainId]: resource.type,
    },
    stakingToken,
    earningToken,
    apr: 0,
    earningTokenPrice,
    stakingTokenPrice,

    // Philip TODO: remove ! logic
    isFinished: !(now > +resource.data.end_timestamp),
    poolCategory: PoolCategory.CORE,
    startBlock: _toNumber(resource.data.start_timestamp),
    tokenPerBlock: resource.data.reward_per_second,
    stakingLimit: resource.data.pool_limit_per_user ? new BigNumber(resource.data.pool_limit_per_user) : BIG_ZERO,
    totalStaked: new BigNumber(totalStakedToken),

    userData,

    profileRequirement: undefined,
  }
}

export default transformPool
