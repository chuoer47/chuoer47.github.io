---
title: "SQL Server安装及使用"
date: 2023-12-28 :43
tags:
- 数据库
category: 本科课程笔记
order: 2
---

# SQL Server安装及使用

个人记录使用，侵权请联系。

## SQL Server的简介
可以百度，也可以简单地看下面这个博客：

[SQLserver与MySQL的区别(数据库小白须知！！！) - 胖出个性 - 博客园 (cnblogs.com)](https://www.cnblogs.com/osghong/p/9894309.html)

##
## SQL Server的安装
教程安装的是2019年的，现在可以下载2022年的。和教程唯一不同的是，有一个Azure的选项需要取消，这样子就完成了安装了。

[SQL Server 最详细安装教程 - 知乎 (zhihu.com)](https://zhuanlan.zhihu.com/p/376812785)

## SQL Server的基本操作
[SQL Server 基础知识 - 知乎 (zhihu.com)](https://zhuanlan.zhihu.com/p/74546690)

当然，也可以看看官方文档：

[SQL Server 2022 | Microsoft](https://www.microsoft.com/en-us/sql-server/sql-server-2022)

## JAVA的连接
可以通过下面代码进行数据库连接，注意需要在lib文件夹放置相应的库包。

![](./SQL-Server安装及使用.assets/image-001-87026b212e.png)

```
public class Dal {
	protected static String dbClassName =
		"com.microsoft.sqlserver.jdbc.SQLServerDriver";//数据库连接驱动类
	protected static String dbUrl = "jdbc:sqlserver://localhost:1433;"
		+ "DatabaseName=cardmange;";//数据库连接URL
	protected static String dbUser = "sa";				//数据库用户名
	protected static String dbPwd = "123456";			//数据库密码
	private static Connection conn = null;				//数据库连接对象
	private Dal() {										//默认构造函数
		try {
			if (conn == null) {							//如果连接对象为空
				Class.forName(dbClassName);				//加载驱动类
				conn = DriverManager.getConnection(dbUrl, dbUser, dbPwd);//获得连接对象
			}
		} catch (Exception ee) {
			ee.printStackTrace();
		}
	}
}
```
可以参考的使用代码：

```
	private static ResultSet executeQuery(String sql) {	//查询方法
		try {
			if(conn==null)  new Dal();  //如果连接对象为空，则重新调用构造方法
			return conn.createStatement(ResultSet.TYPE_SCROLL_SENSITIVE,
					ResultSet.CONCUR_UPDATABLE).executeQuery(sql);//执行查询
		} catch (SQLException e) {
			e.printStackTrace();
			return null;				//返回null值
		} finally {
		}
	}

	private static int executeUpdate(String sql) {		//更新方法
		try {
			if(conn==null)  new Dal();	//如果连接对象为空，则重新调用构造方法
			return conn.createStatement().executeUpdate(sql);//执行更新
		} catch (SQLException e) {
			e.printStackTrace();
			return -1;
		} finally {
		}
	}

	public static void close() {//关闭方法
		try {
			conn.close();//关闭连接对象
		} catch (SQLException e) {
			e.printStackTrace();
		}finally{
			conn = null;	//设置连接对象为null值
		}
	}

```
查询cardmange的表user，比如

```
	public static users check(String name, String password) {
		users user=new users();//操作员信息对象
		String sql = "select * from users where name= '" + name
		+ "' and password='" + password+"'";//查询字符串
		ResultSet rs = Dal.executeQuery(sql);//执行查询
		try {
			while(rs.next()) {//如果查询到了记录
				user.setCardid(rs.getInt("cardid"));
				user.setName(rs.getString("name")) ;
				user.setUserstype(rs.getString("userstype")) ;
				user.setPassword(rs.getString("password"));
				user.setCardtype(rs.getString("cardtype"));
				user.setCarid(rs.getInt("carid"));
				user.setOverage(rs.getInt("overage"));
				user.setTel(rs.getInt("tel"));
			}
		} catch (SQLException e){
			e.printStackTrace();
		}
		Dal.close();	//关闭连接对象
		return user;//返回操作员信息对象
	}
```
```
/**
 * 功能：用户模型类，定义了用户属性及相应get、set方法
 * 修改：如果进行了修改，这里填写修改信息
 */
package whsdu.se.DAO;

public class users {

	private int cardid;
	private String name;
	private String password;
	private String cardtype;
	private int carid;
	private int tel;
	private int overage;
	private String userstype;

	public int getCardid() {
		return cardid;
	}
	public void setCardid(int cardid) {
		this.cardid = cardid;
	}
	public String getName() {
		return name;
	}
	public  void setName(String name) {
		this.name = name;
	}
	public String getPassword() {
		return password;
	}
	public void setPassword(String password) {
		this.password = password;
	}
	public String getCardtype() {
		return cardtype;
	}
	public void setCardtype(String cardtype) {
		this.cardtype = cardtype;
	}
	public int getCarid() {
		return carid;
	}
	public void setCarid(int carid) {
		this.carid = carid;
	}
	public int getTel() {
		return tel;
	}
	public void setTel(int tel) {
		this.tel = tel;
	}
	public int getOverage() {
		return overage;
	}
	public void setOverage(int overage) {
		this.overage = overage;
	}
	public String getUserstype() {
		return userstype;
	}
	public void setUserstype(String userstype) {
		this.userstype = userstype;
	}

}

```
至此，部分功能和连接讲解完毕，不过不是很全。

## 数据库
SQL的数据库可以通过mdf和ldf文件进行导入，详细的导入过程可以查看下面博客：

参考1：

[sqlsever2019:添加mdf和ldf文件_sqlserver导入mdf和ldf文件-CSDN博客](https://blog.csdn.net/weixin_46211269/article/details/122151431?ops_request_misc=%257B%2522request%255Fid%2522%253A%2522170368118916800186572300%2522%252C%2522scm%2522%253A%252220140713.130102334.pc%255Fall.%2522%257D&request_id=170368118916800186572300&biz_id=0&utm_medium=distribute.pc_search_result.none-task-blog-2~all~first_rank_ecpm_v1~rank_v31_ecpm-1-122151431-null-null.142%5Ev99%5Epc_search_result_base7&utm_term=SQL%20Sever%E6%80%8E%E4%B9%88%E4%BD%BF%E7%94%A8mdf%E6%96%87%E4%BB%B6&spm=1018.2226.3001.4187)

参考2：

[完美解决Window11附加表时: Microsoft SQL Server Management Studio-附加数据库时出错。有关详细信息，请单击“消息”列中_标题: microsoft sql server management studio --------CSDN博客](https://blog.csdn.net/CatShitK/article/details/134174526?ops_request_misc=%257B%2522request%255Fid%2522%253A%2522170368176916800185854988%2522%252C%2522scm%2522%253A%252220140713.130102334.pc%255Fall.%2522%257D&request_id=170368176916800185854988&biz_id=0&utm_medium=distribute.pc_search_result.none-task-blog-2~all~first_rank_ecpm_v1~rank_v31_ecpm-1-134174526-null-null.142%5Ev99%5Epc_search_result_base7&utm_term=%E6%A0%87%E9%A2%98%3A%20Microsoft%20SQL%20Server%20Management%20Studio%20------------------------------%20%20%E6%9C%8D%E5%8A%A1%E5%99%A8%20LAPTOP-G5AA19SK%20%E7%9A%84%20%E9%99%84%E5%8A%A0%E6%95%B0%E6%8D%AE%E5%BA%93%20%E5%A4%B1%E8%B4%A5%E3%80%82%20%20%28Microsoft.SqlServer.Smo%29%20%20%E6%9C%89%E5%85%B3%E5%B8%AE%E5%8A%A9%E4%BF%A1%E6%81%AF%EF%BC%8C%E8%AF%B7%E5%8D%95%E5%87%BB%3A%20https%3A%2F%2Fgo.microsoft.com%2FfwlinkProdName%3DMicrosoft%2B&spm=1018.2226.3001.4187)

参考3：

[com.microsoft.sqlserver.jdbc.SQLServerException: 通过端口 1433 连接到主机 localhost 的 TCP/IP 连接失败。-CSDN博客](https://blog.csdn.net/zhouwenyan2548/article/details/110730840?ops_request_misc=&request_id=&biz_id=102&utm_term=com.microsoft.sqlserver.jdbc.S&utm_medium=distribute.pc_search_result.none-task-blog-2~all~sobaiduweb~default-1-110730840.142%5Ev99%5Epc_search_result_base7&spm=1018.2226.3001.4187)

相关项目：

[zhujainxipan/Parking-lot-management-system: 使用java开发。实现停车场管理系统，应用于车辆的出、入管理。 (github.com)](https://github.com/zhujainxipan/Parking-lot-management-system)
