import { join } from 'node:path'
import { startApplication } from '@yikart/common'
import helmet from 'helmet'
import { AppModule } from './app.module'
import { config } from './config'

startApplication(AppModule, config, {
  setupApp: (app) => {
    app.enableCors()
    app.use(helmet())

    app.setViewEngine('ejs')
    app.setBaseViewsDir(join(__dirname, 'views'))
    app.useStaticAssets(join(__dirname, 'public'))
  },
})
